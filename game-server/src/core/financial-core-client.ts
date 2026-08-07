/**
 * FinancialCoreClient — the ONLY way the game server touches money (iron rule #3, FairPlay §7).
 *
 * Games depend on this interface, never on a database. All amounts are decimal strings (the FC API
 * contract). The HTTP implementation calls the Financial Core's internal endpoints with the shared
 * service secret. Tests inject a mock implementing the interface.
 */

export interface JackpotAccounts {
  mini: string;
  minor: string;
  major: string;
  grand: string;
}

export interface SettleRoundRequest {
  roundId: string;
  tableType: 'PLATFORM' | 'LEAGUE';
  leagueId?: string;
  winnerAccountId: string;
  winnerProfit: string;
  rake: string;
  jackpotAccounts: JackpotAccounts;
}

export interface SettlementReceipt {
  roundId: string;
  sequence: string[];
  amounts: { jackpot: string; rake: string; payout: string };
  accounts: Record<string, string>;
  hash: string;
}

export interface TableSettlementParty {
  playerAccountId: string;
  amount: string;
}

/**
 * Multi-party table-hand settlement: each loser's locked balance drops, each winner's rises, the
 * rake goes to the house, and the jackpot is injected. Σ(losers) = Σ(winners) + rake + Σ(jackpot).
 */
export interface TableSettlementRequest {
  roundId: string;
  /**
   * Which game settled. Optional so existing callers keep working unchanged.
   *
   * Supply it and the client records per-player play volume after the hand,
   * which is what drives VIP progress, per-game RTP and play distribution. The
   * VIP ladder weights volume per game (Texas x1.0, Niu Niu x0.5, Baccarat
   * x0.3, others x0.4), so without this the hand simply is not counted — it is
   * never counted wrongly.
   */
  gameId?: string;
  tableType: 'PLATFORM' | 'LEAGUE';
  leagueId?: string;
  losers: TableSettlementParty[];
  winners: TableSettlementParty[];
  rake: string;
  jackpot: { mini: string; minor: string; major: string; grand: string };
  jackpotAccounts: JackpotAccounts;
}

export interface FinancialCoreClient {
  /** Lock a player's buy-in at a table (available → locked). */
  buyIn(playerAccountId: string, amount: string): Promise<void>;
  /** Release a player's stack on leaving (locked → available). */
  release(playerAccountId: string, amount: string): Promise<void>;
  /** Settle a finished hand (jackpot inject → rake). Idempotent on roundId. */
  settleRound(req: SettleRoundRequest): Promise<SettlementReceipt>;
  /** Settle a full multi-party table hand (losers/winners/rake/jackpot). Idempotent on roundId. */
  settleTableHand(req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }>;
}

export class FinancialCoreError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Financial Core API ${status}: ${message}`);
    this.name = 'FinancialCoreError';
  }
}

export interface HttpClientOptions {
  /** e.g. http://financial-core:4001/api/v1 */
  baseUrl: string;
  internalSecret: string;
  fetchImpl?: typeof fetch;
}

export class HttpFinancialCoreClient implements FinancialCoreClient {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly doFetch: typeof fetch;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.secret = opts.internalSecret;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': this.secret },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new FinancialCoreError(res.status, detail);
    }
    return (await res.json()) as T;
  }

  async buyIn(playerAccountId: string, amount: string): Promise<void> {
    await this.post('/internal/buy-ins', { playerAccountId, amount });
  }

  async release(playerAccountId: string, amount: string): Promise<void> {
    await this.post('/internal/releases', { playerAccountId, amount });
  }

  async settleRound(req: SettleRoundRequest): Promise<SettlementReceipt> {
    return this.post<SettlementReceipt>('/internal/settlements', req);
  }

  async settleTableHand(
    req: TableSettlementRequest,
  ): Promise<{ roundId: string; applied: boolean }> {
    const result = await this.post<{ roundId: string; applied: boolean }>(
      '/internal/table-settlements',
      req,
    );

    // Both AFTER the money has settled and only if it did. Recording volume or
    // announcing a win for a hand that failed to settle would report something
    // that did not happen.
    if (result.applied) {
      if (req.gameId !== undefined) await this.recordHandVolume(req, req.gameId);
      await this.announceHand(req);
    }
    return result;
  }

  /**
   * Tell each seat what happened to them.
   *
   * Sends a translation key and its parameters, never prose — the player's
   * language is resolved when they read it, so a hand settled at 3am is
   * described in whatever language they are reading in now.
   *
   * eventId is round-and-player scoped, so a settlement retry cannot announce
   * one win twice. Failures are swallowed for the same reason as volume: a
   * missing notification is a missing notification, whereas throwing would fail
   * a hand whose ledger entries are already written.
   */
  private async announceHand(req: TableSettlementRequest): Promise<void> {
    const seats = [
      ...req.winners.map((p) => ({ party: p, kind: 'RESULT' as const, titleKey: 'notifications.handWon' })),
      ...req.losers.map((p) => ({ party: p, kind: 'RESULT' as const, titleKey: 'notifications.handLost' })),
    ];

    await Promise.all(
      seats.map(async ({ party, kind, titleKey }) => {
        try {
          await this.post('/internal/notifications', {
            playerAccountId: party.playerAccountId,
            kind,
            titleKey,
            eventId: `${req.roundId}:${party.playerAccountId}`,
            params: { amount: party.amount },
          });
        } catch (err) {
          console.error('[fc-client] notification not raised for', party.playerAccountId, err);
        }
      }),
    );
  }

  /**
   * Log each seat's volume for a settled hand.
   *
   * Deliberately swallows its own failures. This is a counter beside the money,
   * not part of it: a dropped call costs one hand of VIP progress, whereas
   * letting it throw would fail a hand that has already settled correctly and
   * whose ledger entries are already written.
   *
   * Losers staked their amount and got nothing back. Winners are credited their
   * net win, so their stake is not in the request — the effective figure is
   * therefore conservative for winners, never inflated. Worth revisiting if the
   * settlement shape ever carries gross stakes.
   */
  private async recordHandVolume(req: TableSettlementRequest, gameId: string): Promise<void> {
    const micros = (decimal: string): number => Math.round(Number(decimal) * 1_000_000);

    const seats = [
      ...req.losers.map((p) => ({ playerAccountId: p.playerAccountId, staked: micros(p.amount), won: 0 })),
      ...req.winners.map((p) => ({ playerAccountId: p.playerAccountId, staked: micros(p.amount), won: micros(p.amount) })),
    ];

    await Promise.all(
      seats.map(async (seat) => {
        try {
          await this.post('/internal/volume', { ...seat, gameId });
        } catch (err) {
          console.error('[fc-client] volume not recorded for', seat.playerAccountId, err);
        }
      }),
    );
  }
}
