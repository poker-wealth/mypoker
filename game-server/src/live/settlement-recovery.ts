import type {
  FinancialCoreClient,
  TableSettlementParty,
  TableSettlementReceipt,
  TableSettlementRequest,
} from '../core/financial-core-client';

/**
 * BUG-20 — settlement committed in FC, response lost → table and ledger disagree.
 *
 * `fc.settleTableHand` can THROW even after FC has already applied the settlement: the request
 * landed, FC committed it, and the reply (or the room's read of it) never arrived — a socket reset,
 * a timeout on a slow-but-successful write, anything between "FC returned 200" and "this process
 * parsed it". A room that treats every throw as "nothing happened" abandons a hand that is, in fact,
 * already settled: the ledger moved, the table did not, and they disagree forever.
 *
 * The fix is never to guess. On any settlement error, ask FC — via `settlementStatus` — whether THIS
 * round settled, and only recover if FC's own stored receipt is byte-for-byte the request the room
 * itself sent. Anything else (no answer, a receipt that doesn't match) means abandon exactly as
 * before this existed. Every false branch below is "abandon"; only the final `true` is "recover".
 */

function partiesMatch(a: TableSettlementParty[], b: TableSettlementParty[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((p) => [p.playerAccountId, Number(p.amount)]));
  if (byId.size !== a.length) return false; // a duplicate playerAccountId can never match 1:1
  for (const p of b) {
    if (!byId.has(p.playerAccountId)) return false;
    if (byId.get(p.playerAccountId) !== Number(p.amount)) return false;
  }
  return true;
}

/**
 * Does FC's stored receipt describe exactly the settlement this room sent? Every field the request
 * carried that the ledger could have disagreed with — the round, the rake, the jackpot total, and
 * every party's amount — must match. A receipt that is close but not exact (a different round reused
 * the id, a rounding difference, a missing party) is NOT a match: it means abandon, same as no
 * receipt at all.
 */
export function receiptMatchesRequest(
  receipt: TableSettlementReceipt,
  req: TableSettlementRequest,
): boolean {
  if (receipt.type !== 'table') return false;
  if (receipt.roundId !== req.roundId) return false;
  if (Number(receipt.rake) !== Number(req.rake)) return false;
  const jackpotTotal =
    Number(req.jackpot.mini) + Number(req.jackpot.minor) + Number(req.jackpot.major) + Number(req.jackpot.grand);
  if (Number(receipt.jackpotTotal) !== jackpotTotal) return false;
  if (!partiesMatch(receipt.losers, req.losers)) return false;
  if (!partiesMatch(receipt.winners, req.winners)) return false;
  return true;
}

/**
 * Ask FC whether `req`'s round already settled, and recover ONLY if it did with exactly this
 * request. `tag` is a short caller label (e.g. `[room ${tableId}]`) for the log lines — every branch
 * here logs, because every branch is a diagnosable event, not silent flow control.
 */
export async function confirmSettled(
  fc: FinancialCoreClient,
  req: TableSettlementRequest,
  tag: string,
): Promise<boolean> {
  if (!fc.settlementStatus) return false;

  let status;
  try {
    status = await fc.settlementStatus(req.roundId);
  } catch (err) {
    console.error(`${tag} settlement status unknown for round ${req.roundId}:`, err);
    return false;
  }

  if (!status.settled) return false;

  if (!status.receipt) {
    console.error(`${tag} round ${req.roundId} is settled in FC but returned no receipt to verify against`);
    return false;
  }

  if (!receiptMatchesRequest(status.receipt, req)) {
    console.error(
      `${tag} round ${req.roundId} is settled in FC with a DIFFERENT receipt — round id reused, not ours`,
    );
    return false;
  }

  return true;
}
