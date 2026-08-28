import { Money } from '../domain/money';
import { getOrCreatePlayerAccount } from '../wallet/system-accounts';
import { DepositAddressModel } from '../wallet/deposit-address';
import { processConfirmedDeposit } from './deposit-credit';
import { PendingDepositModel } from './pending-deposit.model';
import { tronApiUrl, tronApiKey, usdtContract, requiredConfirmations, depositPollMs } from '../config/chain';

/**
 * Deposit watcher.
 *
 * The one piece the deposit path was missing: something that watches the chain
 * and feeds confirmed transfers into the (already-tested, idempotent) credit
 * path. It polls TronGrid for TRC-20 transfers INTO each player's deposit
 * address and hands every one to processConfirmedDeposit, which enforces the
 * accepted-contract and confirmation gates and dedups on txHash. Re-scanning is
 * therefore safe — a transfer seen twice credits once.
 *
 * Network-agnostic: it watches whatever `config/chain` says (testnet token +
 * Nile RPC now; mainnet USDT + api.trongrid.io at launch), no code change.
 */

/** An incoming TRC-20 transfer, normalised out of whatever the source returns. */
export interface IncomingTransfer {
  txHash: string;
  to: string;
  /** token contract of the transfer */
  contract: string;
  /** decimal string in token units, e.g. '500.000000' */
  amount: string;
  confirmations: number;
}

/** Returns confirmed incoming transfers for one address. Injectable for tests. */
export type TransferSource = (address: string) => Promise<IncomingTransfer[]>;

interface TronGridTrc20Tx {
  transaction_id: string;
  to: string;
  from: string;
  type: string;
  value: string;
  token_info: { address: string; decimals: number };
}

/** raw base-unit integer string → decimal string with `decimals` places. */
function rawToDecimal(raw: string, decimals: number): string {
  const neg = raw.startsWith('-');
  const digits = (neg ? raw.slice(1) : raw).padStart(decimals + 1, '0');
  const cut = digits.length - decimals;
  const whole = digits.slice(0, cut);
  const frac = decimals > 0 ? '.' + digits.slice(cut) : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
}

/** The live source: TronGrid's confirmed TRC-20 transfers for the accepted contract. */
export const tronGridSource: TransferSource = async (address) => {
  const url =
    `${tronApiUrl()}/v1/accounts/${address}/transactions/trc20` +
    `?only_confirmed=true&contract_address=${usdtContract()}&limit=50`;
  const headers: Record<string, string> = { accept: 'application/json' };
  const key = tronApiKey();
  if (key) headers['TRON-PRO-API-KEY'] = key;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TronGrid ${res.status} for ${address}`);
  const body = (await res.json()) as { data?: TronGridTrc20Tx[] };

  return (body.data ?? [])
    .filter((t) => t.type === 'Transfer' && t.to === address)
    .map((t) => ({
      txHash: t.transaction_id,
      to: t.to,
      contract: t.token_info.address,
      amount: rawToDecimal(t.value, t.token_info.decimals),
      // only_confirmed=true → TRON already treats it as final. Pass the required
      // count so the credit gate's confirmation check is satisfied.
      confirmations: requiredConfirmations(),
    }));
};

/**
 * Transfers the chain has seen but not yet confirmed.
 *
 * The same query as `tronGridSource` with the flag flipped. These are NEVER
 * credited — they exist only so the wallet can show "pending" instead of
 * nothing while a player waits out the confirmation window, which is around a
 * minute and is otherwise completely silent from their side.
 */
export const tronGridUnconfirmedSource: TransferSource = async (address) => {
  const url =
    `${tronApiUrl()}/v1/accounts/${address}/transactions/trc20` +
    `?only_unconfirmed=true&contract_address=${usdtContract()}&limit=50`;
  const headers: Record<string, string> = { accept: 'application/json' };
  const key = tronApiKey();
  if (key) headers['TRON-PRO-API-KEY'] = key;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TronGrid ${res.status} for ${address}`);
  const body = (await res.json()) as { data?: TronGridTrc20Tx[] };

  return (body.data ?? [])
    .filter((t) => t.type === 'Transfer' && t.to === address)
    .map((t) => ({
      txHash: t.transaction_id,
      to: t.to,
      contract: t.token_info.address,
      amount: rawToDecimal(t.value, t.token_info.decimals),
      // Zero by definition. Nothing downstream may treat this as creditable.
      confirmations: 0,
    }));
};

/** One scan of every player deposit address. Idempotent — safe to call repeatedly. */
export async function pollDepositsOnce(
  source: TransferSource = tronGridSource,
  unconfirmedSource: TransferSource | null = tronGridUnconfirmedSource,
): Promise<{ scanned: number; credited: number; pending: number }> {
  const addresses = await DepositAddressModel.find().lean();
  let credited = 0;
  let pending = 0;

  for (const rec of addresses) {
    let transfers: IncomingTransfer[];
    try {
      transfers = await source(rec.address);
    } catch (err) {
      // A per-address failure must not stop the rest — log and move on.
      console.error(`[deposit-watcher] source failed for ${rec.address}:`, (err as Error).message);
      continue;
    }

    for (const tr of transfers) {
      if (tr.to !== rec.address) continue; // never credit an outgoing/mismatched transfer
      // rec._id is the playerId; resolve to their money account.
      const account = await getOrCreatePlayerAccount(rec._id);
      const outcome = await processConfirmedDeposit({
        playerAccountId: account._id,
        amount: Money.fromDecimalString(tr.amount),
        txHash: tr.txHash,
        contractAddress: tr.contract,
        confirmations: tr.confirmations,
      });
      if (outcome.credited) {
        credited++;
        console.log(`[deposit-watcher] credited ${tr.amount} to ${rec._id} (${tr.txHash})`);
      }
      // It is confirmed, so it is no longer "on its way" — whatever the outcome.
      // A wrong-contract transfer stops being pending too; it was refused, and
      // leaving it showing as incoming would be the worse lie.
      await PendingDepositModel.deleteOne({ _id: tr.txHash }).catch(() => undefined);
    }

    // Sightings, recorded so the wallet can say "pending". NEVER credited: this
    // whole branch is deliberately unable to move money — it writes to its own
    // collection and calls nothing in the money path.
    if (!unconfirmedSource) continue;
    try {
      const inFlight = await unconfirmedSource(rec.address);
      for (const tr of inFlight) {
        if (tr.to !== rec.address) continue;
        const account = await getOrCreatePlayerAccount(rec._id);
        await PendingDepositModel.updateOne(
          { _id: tr.txHash },
          {
            $setOnInsert: {
              _id: tr.txHash,
              playerId: rec._id,
              playerAccountId: account._id,
              address: rec.address,
              amount: Money.fromDecimalString(tr.amount).toDecimal128(),
              contract: tr.contract,
            },
          },
          { upsert: true },
        );
        pending++;
      }
    } catch (err) {
      // Strictly cosmetic data. A failure here must never interrupt crediting.
      console.error(
        `[deposit-watcher] unconfirmed scan failed for ${rec.address}:`,
        (err as Error).message,
      );
    }
  }

  return { scanned: addresses.length, credited, pending };
}

/** Poll forever on the configured interval. Returns a stop handle. */
export function runWatcher(pollMs: number = depositPollMs()): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await pollDepositsOnce();
    } catch (err) {
      console.error('[deposit-watcher] poll failed:', (err as Error).message);
    }
    if (!stopped) timer = setTimeout(() => void tick(), pollMs);
  };

  void tick();
  return {
    stop: (): void => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
