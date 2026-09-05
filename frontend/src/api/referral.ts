import { api } from './client';

/**
 * Bind the signed-in player to the referral link they arrived on.
 *
 * Permanent and set once server-side — a second call for an already-attributed
 * player is a no-op, not an update (see financial-core's `POST /me/referral`).
 * That means this is safe to fire on every login without any "have I already
 * bound this" check on the client: the server owns that guarantee.
 */
export const bindReferral = (linkId: string): Promise<void> =>
  api.post<void>('/me/referral', { linkId });
