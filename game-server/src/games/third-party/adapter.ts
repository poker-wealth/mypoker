import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FinancialCoreClient, JackpotAccounts } from '../../core/financial-core-client';
import { settleNet, toTableSettlementRequest } from '../texas/settlement';

/**
 * ThirdPartyAdapter — the isolation boundary around an external game provider (Lottery, Slots).
 *
 * The provider is UNTRUSTED. It never sees the Financial Core, never holds a balance, and never
 * moves a coin: it is handed a wager and returns a *signed* claim of what the round paid. This
 * adapter is the only thing that can turn that claim into money, and it will not do so unless:
 *
 *   1. the signature over (roundId, playerId, wager, payout) verifies under the shared secret,
 *   2. the result is bound to the exact round we asked for (no swapping in another round's win),
 *   3. the payout is within the agreed exposure cap (a compromised provider cannot drain us),
 *   4. the round has not already been settled (replays return the original receipt, no double pay).
 *
 * Money moves player ⇄ the PROVIDER's own funded account — the platform is never the banker here
 * either; it takes only a commission, as a rake at settlement.
 */

export class ProviderSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderSecurityError';
  }
}

export interface RoundRequest {
  roundId: string;
  playerId: string;
  wager: number;
}

export interface RoundResult {
  roundId: string;
  payout: number;
  /** Provider-specific detail (reels, drawn numbers…) — informational only, never trusted for money. */
  outcome: unknown;
  /** Provably-fair material the provider publishes so a player can verify the round. */
  commit?: string;
  serverSeed?: string;
}

export interface SignedRoundResult {
  result: RoundResult;
  signature: string;
}

/** Implemented OUTSIDE our trust boundary. Has no FC access by construction — it is handed none. */
export interface ThirdPartyProvider {
  readonly name: string;
  playRound(req: RoundRequest): Promise<SignedRoundResult>;
}

export interface AdapterConfig {
  provider: ThirdPartyProvider;
  /** Shared secret used to sign/verify results. */
  secret: string;
  /** The provider's own funded FC account — the counterparty for every round. */
  providerAccountId: string;
  /** Hard cap: a round may never pay more than wager × this. */
  maxPayoutMultiple: number;
  /** Platform commission on winnings, in basis points. */
  commissionBps: number;
  tableType: 'PLATFORM' | 'LEAGUE';
  accountOf: (playerId: string) => string;
  jackpotAccounts: JackpotAccounts;
}

export interface Receipt {
  roundId: string;
  playerId: string;
  wager: number;
  payout: number;
  /** Player's net for the round (payout − wager). */
  net: number;
  outcome: unknown;
  replayed: boolean;
}

/** Canonical bytes a provider must sign. Any tamper to payout/round/player breaks the signature. */
export function signingPayload(r: {
  roundId: string;
  playerId: string;
  wager: number;
  payout: number;
}): string {
  return `${r.roundId}|${r.playerId}|${r.wager}|${r.payout}`;
}

export function signResult(
  secret: string,
  r: { roundId: string; playerId: string; wager: number; payout: number },
): string {
  return createHmac('sha256', secret).update(signingPayload(r)).digest('hex');
}

function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export class ThirdPartyAdapter {
  private readonly cfg: AdapterConfig;
  private readonly fc: FinancialCoreClient;
  private readonly settled = new Map<string, Receipt>();
  private readonly providerPlayerId: string;

  constructor(fc: FinancialCoreClient, cfg: AdapterConfig) {
    this.fc = fc;
    this.cfg = cfg;
    this.providerPlayerId = `provider:${cfg.provider.name}`;
  }

  /** Play one round: ask the provider, verify its claim, then (and only then) settle via the FC. */
  async play(playerId: string, roundId: string, wager: number): Promise<Receipt> {
    if (!Number.isInteger(wager) || wager <= 0) throw new RangeError('wager must be a positive integer');

    // Replay protection: a round settles exactly once, no matter how often it is submitted.
    const prior = this.settled.get(roundId);
    if (prior) return { ...prior, replayed: true };

    const signed = await this.cfg.provider.playRound({ roundId, playerId, wager });
    const { result, signature } = signed;

    // (2) The result must be for the round we asked about — not another player's, not another round's.
    if (result.roundId !== roundId) {
      throw new ProviderSecurityError('provider returned a result for a different round');
    }
    if (!Number.isInteger(result.payout) || result.payout < 0) {
      throw new ProviderSecurityError('payout must be a non-negative integer');
    }
    // (3) Exposure cap — the ceiling on what a compromised provider could ever claim.
    if (result.payout > wager * this.cfg.maxPayoutMultiple) {
      throw new ProviderSecurityError(
        `payout ${result.payout} exceeds the ${this.cfg.maxPayoutMultiple}× exposure cap`,
      );
    }
    // (1) Signature last-but-binding: covers roundId, playerId, wager AND payout together.
    const payload = signingPayload({ roundId, playerId, wager, payout: result.payout });
    if (!verifySignature(this.cfg.secret, payload, signature)) {
      throw new ProviderSecurityError('invalid provider signature');
    }

    const net = result.payout - wager;
    if (net !== 0) {
      // Player ⇄ provider account. Sums to zero; the platform only rakes a commission.
      const grossNets = new Map<string, number>([
        [playerId, net],
        [this.providerPlayerId, -net],
      ]);
      const settlement = settleNet(grossNets, { rakeBps: this.cfg.commissionBps });
      const request = toTableSettlementRequest(settlement, {
        roundId,
        tableType: this.cfg.tableType,
        accountOf: (p) => (p === this.providerPlayerId ? this.cfg.providerAccountId : this.cfg.accountOf(p)),
        jackpotAccounts: this.cfg.jackpotAccounts,
      });
      await this.fc.settleTableHand(request);
    }

    const receipt: Receipt = {
      roundId,
      playerId,
      wager,
      payout: result.payout,
      net,
      outcome: result.outcome,
      replayed: false,
    };
    this.settled.set(roundId, receipt);
    return receipt;
  }

  getReceipt(roundId: string): Receipt | undefined {
    return this.settled.get(roundId);
  }
}
