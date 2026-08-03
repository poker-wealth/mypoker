/**
 * Spectator mode (FairPlay v5.9 — league-configurable, §2.1).
 *
 * THE RULE THAT MATTERS: a spectator sees exactly what the public sees — never a hole card, never a
 * seed before reveal. A spectator with private information is a collusion channel: sit out, watch
 * everyone's cards, message a friend at the table. So `spectatorView()` is built by REDACTION, not
 * by assembling a "safe" copy — it starts from the table's public state and strips anything private,
 * which means a new private field cannot leak by being forgotten.
 *
 * Spectators are also silent by default in the hand: they cannot act, and leagues may turn spectating
 * off entirely.
 */

export interface TableSnapshot {
  tableId: string;
  phase: string;
  /** Cards visible to everyone. */
  community: string[];
  pot: number;
  seats: { playerId: string; stack: number; folded: boolean }[];
  /** PRIVATE — per-player hole cards. Never leaves the server for a spectator. */
  holeCards: Record<string, string[]>;
  /** PRIVATE until the hand resolves — revealing early would expose the deal. */
  serverSeed?: string;
}

export interface SpectatorView {
  tableId: string;
  phase: string;
  community: string[];
  pot: number;
  seats: { playerId: string; stack: number; folded: boolean }[];
  spectating: true;
}

export class SpectatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpectatorError';
  }
}

/** Redact a table snapshot down to what a spectator may see. */
export function spectatorView(snapshot: TableSnapshot): SpectatorView {
  // Destructure the private fields OUT; everything else is public by definition.
  const { holeCards: _hole, serverSeed: _seed, ...publicState } = snapshot;
  return { ...publicState, spectating: true };
}

/** A spectator can never take a game action — they are not in the hand. */
export function spectatorMayAct(): false {
  return false;
}

export interface SpectatorPolicy {
  /** Leagues may switch spectating off for their tables (§2.1 league autonomy). */
  spectatorsAllowed: boolean;
  /** A player already seated at this table is a player, not a spectator. */
  seatedPlayerIds: readonly string[];
}

export function maySpectate(policy: SpectatorPolicy, viewerId: string): { ok: boolean; reason?: string } {
  if (!policy.spectatorsAllowed) return { ok: false, reason: 'spectating is disabled at this table' };
  if (policy.seatedPlayerIds.includes(viewerId)) {
    return { ok: false, reason: 'you are seated at this table' };
  }
  return { ok: true };
}
