import { notify } from '../notification-store';
import { sendEmail } from './send-email';
import { depositReceived, withdrawalRequested, withdrawalSent } from './templates';

/**
 * The money events a player is told about, in one place.
 *
 * SAMUEL.md: "Hook into the same place the in-app notification already fires —
 * don't build a parallel event system." So this is not a second event bus. It
 * is one call that raises the in-app notification and the email from the same
 * event id, and it is the only thing the deposit and withdrawal paths call.
 * Two separate call sites would drift the first time someone added an event to
 * one and forgot the other.
 *
 * The in-app notification did not previously fire for deposits or withdrawals
 * at all — notify() had a single caller, the internal endpoint the gateway
 * posts to for jackpot wins — so "the place it already fires" had to be made
 * to exist before email could ride it.
 *
 * NOTHING HERE MAY FAIL THE MONEY PATH. Every call is wrapped: a mail server
 * refusing connections, a settings lookup timing out, must not roll back a
 * credit that already happened. The money is the product; the receipt is a
 * courtesy.
 */

/**
 * Where a player's email address comes from.
 *
 * UNRESOLVED BY DESIGN — this returns null until someone wires it, and every
 * send degrades to 'no_recipient', which is already a normal outcome.
 *
 * financial-core cannot answer this question. The user store — and every email
 * address — lives in the gateway (game-server/src/auth/user-store.ts); this
 * service holds accounts keyed by playerId with no PII, and per
 * docs/handoff/02-architecture.md it never calls outward. Resolving it means
 * either copying addresses into this service or having the gateway supply
 * them, and that is an architecture and PII decision, not an implementation
 * detail — so it is left as one named seam rather than guessed at.
 *
 * Wiring it is the only change needed to turn every money email on.
 */
export type RecipientResolver = (playerId: string) => Promise<string | null>;

let resolveRecipient: RecipientResolver = () => Promise.resolve(null);

/** Install the address lookup once, at startup, when it has been decided. */
export function setRecipientResolver(resolver: RecipientResolver): void {
  resolveRecipient = resolver;
}

async function announce(input: {
  playerId: string;
  eventId: string;
  kind: 'DEPOSIT' | 'SYSTEM';
  titleKey: string;
  params: Record<string, string | number>;
  template: Parameters<typeof sendEmail>[1];
}): Promise<void> {
  try {
    await notify({
      playerId: input.playerId,
      kind: input.kind,
      titleKey: input.titleKey,
      eventId: input.eventId,
      params: input.params,
    });
  } catch (err) {
    console.error(`[money-mail] in-app notification failed for ${input.eventId}:`, err);
  }

  try {
    const to = await resolveRecipient(input.playerId);
    // Same event id as the notification: one event, one email, however many
    // times the credit or the transition is retried.
    await sendEmail(to, input.template, input.eventId);
  } catch (err) {
    console.error(`[money-mail] email failed for ${input.eventId}:`, err);
  }
}

/** Money in — called after the credit is written, never before. */
export async function announceDeposit(input: {
  playerId: string;
  /** Ledger decimal string. */
  amount: string;
  txHash: string;
  network: string;
  at?: Date;
}): Promise<void> {
  const at = input.at ?? new Date();
  await announce({
    playerId: input.playerId,
    // The tx hash is already the credit's idempotency key, so the receipt is
    // idempotent on exactly what the money was idempotent on.
    eventId: `deposit:${input.txHash}`,
    kind: 'DEPOSIT',
    titleKey: 'notifications.depositCredited',
    params: { amount: input.amount },
    template: depositReceived({
      amount: input.amount,
      txHash: input.txHash,
      network: input.network,
      at,
    }),
  });
}

/** Money out, step one — the receipt for a request. */
export async function announceWithdrawalRequested(input: {
  playerId: string;
  withdrawalId: string;
  amount: string;
  address: string;
  at?: Date;
}): Promise<void> {
  await announce({
    playerId: input.playerId,
    eventId: `withdrawal:${input.withdrawalId}:requested`,
    // SYSTEM, not DEPOSIT: money leaving an account is a security notice, and
    // §notification toggles make SYSTEM unsuppressible. A player who has
    // muted deposit alerts must still be told that funds are being sent out —
    // that message is how they find out about a withdrawal they did not make.
    kind: 'SYSTEM',
    titleKey: 'notifications.withdrawalRequested',
    params: { amount: input.amount },
    template: withdrawalRequested({
      amount: input.amount,
      address: input.address,
      at: input.at ?? new Date(),
    }),
  });
}

/** Money out, step two — it has been broadcast. */
export async function announceWithdrawalSent(input: {
  playerId: string;
  withdrawalId: string;
  amount: string;
  address: string;
  txHash: string;
  network: string;
  at?: Date;
}): Promise<void> {
  await announce({
    playerId: input.playerId,
    eventId: `withdrawal:${input.withdrawalId}:sent`,
    kind: 'SYSTEM',
    titleKey: 'notifications.withdrawalSent',
    params: { amount: input.amount },
    template: withdrawalSent({
      amount: input.amount,
      address: input.address,
      txHash: input.txHash,
      network: input.network,
      at: input.at ?? new Date(),
    }),
  });
}
