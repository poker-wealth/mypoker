import { randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Who may reach a private table.
 *
 * Until now `visibility` was written when a table was created and never read
 * again — grep it: the word appeared in `player-table-routes.ts` and nowhere
 * else in `game-server`. "Private" meant *unlisted*, and nothing more. The 12
 * hex characters of the table id were the entire access control, so anyone who
 * was forwarded a link — or who guessed one — could take a seat.
 *
 * Both references treat the code as the address rather than as a convenience:
 * WPK offers "Join Table — join with code", and HHPoker gives it a whole screen
 * ("Enter game PIN to join") and prints the code on the felt beside the table id
 * and the blinds. See docs/REFERENCE-STUDY-HH.md §3 and §14.2.
 *
 * ── The shape, and why ──────────────────────────────────────────────────────
 *
 * `mayJoin()` returns a VERDICT and never the code. That is deliberate, and it
 * is the lesson of TRAPS §20: the fix that mattered for the Google suspension
 * hole was not adding a check, it was making `oauth()` return a verdict so a
 * caller could not reach the identity without stepping past the refusal. Same
 * here — a future caller cannot accidentally obtain the code by asking whether
 * someone may join, because that call does not have it to give.
 *
 * `codeFor()` is the only way to read a code, and it answers for one player at
 * a time: you get it if you already hold access, and otherwise you get null.
 *
 * ── Lifetime ────────────────────────────────────────────────────────────────
 *
 * In memory, deliberately. A code lives exactly as long as the room it guards,
 * and rooms live in `TableHub`, which is also in memory — restart the process
 * and both are gone together. That is consistent rather than lossy.
 *
 * IF ROOMS EVER PERSIST, CODES MUST PERSIST WITH THEM. A surviving room whose
 * code did not survive is a private table that has quietly become public, which
 * is the exact failure this module exists to prevent.
 */

/** Digits only: HH's is `272490`, and a code is read aloud and typed by hand. */
const CODE_LENGTH = 6;

/**
 * Wrong guesses tolerated per player, per table, before that pairing is refused
 * outright. Six digits is a million combinations, which is plenty against a
 * human and nothing at all against a script — the socket has a rate limiter but
 * `/unlock` is an ordinary HTTP route, so the ceiling belongs here.
 *
 * Counted per (table, player) rather than per table so one attacker cannot lock
 * a table's real guests out by burning the budget. It is not a global limit and
 * does not pretend to be one; a determined attacker with many accounts is a
 * different problem, addressed by the account cost, not by this counter.
 */
const MAX_ATTEMPTS = 10;

interface Entry {
  /** Absent for a public table. Public tables are registered too, so that an unknown id is
   *  distinguishable from a known-public one. */
  code?: string;
  /** Players who have proved they hold the code, plus the creator. */
  unlocked: Set<string>;
  /** Wrong guesses so far, per player. */
  attempts: Map<string, number>;
}

export type UnlockResult = 'ok' | 'wrong-code' | 'too-many-attempts' | 'unknown-table';

export class TableAccess {
  private readonly tables = new Map<string, Entry>();

  /**
   * Record a newly created table.
   *
   * Returns the minted code for a private table and `null` for a public one, so
   * the caller cannot forget to handle the private case: there is no code to
   * hand back for a public table and the type says as much.
   */
  register(tableId: string, visibility: 'public' | 'private', creatorPlayerId: string): string | null {
    if (visibility === 'public') {
      this.tables.set(tableId, { unlocked: new Set(), attempts: new Map() });
      return null;
    }
    // randomInt, not Math.random: this is a credential, and Math.random is
    // neither uniform nor unpredictable enough to be one.
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) code += String(randomInt(0, 10));
    // The creator is unlocked by construction — they were just shown the code.
    this.tables.set(tableId, { code, unlocked: new Set([creatorPlayerId]), attempts: new Map() });
    return code;
  }

  /**
   * May this player reach this table at all — to watch it or to sit at it?
   *
   * Unknown tables answer `true`. That is not a fail-open default so much as a
   * statement of scope: the fixed lobby tables and the league tables are not
   * registered here, and league membership is checked by financial-core on its
   * own path. This module is the authority for the tables it was told about and
   * claims nothing about the others.
   */
  mayJoin(tableId: string, playerId: string): boolean {
    const entry = this.tables.get(tableId);
    if (!entry) return true;
    if (!entry.code) return true;
    return entry.unlocked.has(playerId);
  }

  /** Try a code. On success the player is remembered and need not send it again. */
  unlock(tableId: string, playerId: string, code: string): UnlockResult {
    const entry = this.tables.get(tableId);
    if (!entry) return 'unknown-table';
    // A public table has nothing to unlock; saying 'ok' keeps the client simple
    // and is true — they may join.
    if (!entry.code) return 'ok';
    if (entry.unlocked.has(playerId)) return 'ok';

    if ((entry.attempts.get(playerId) ?? 0) >= MAX_ATTEMPTS) return 'too-many-attempts';

    if (!constantTimeEquals(code, entry.code)) {
      entry.attempts.set(playerId, (entry.attempts.get(playerId) ?? 0) + 1);
      return 'wrong-code';
    }

    entry.unlocked.add(playerId);
    entry.attempts.delete(playerId);
    return 'ok';
  }

  /**
   * The code, for a player who already holds access — so the creator can show it
   * on the table and share it. Anyone else gets null, including for a table that
   * does not exist, so this cannot be used to probe which ids are real.
   */
  codeFor(tableId: string, playerId: string): string | null {
    const entry = this.tables.get(tableId);
    if (!entry?.code) return null;
    return entry.unlocked.has(playerId) ? entry.code : null;
  }

  /** Drop a table's record when its room goes away. */
  forget(tableId: string): void {
    this.tables.delete(tableId);
  }
}

/**
 * Compare without leaking the answer through timing.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself be a signal,
 * so the length is checked first and a mismatched length short-circuits — the
 * code length is fixed and public, so that leaks nothing an attacker did not
 * already know.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** The process-wide instance. One table registry, as there is one hub. */
export const tableAccess = new TableAccess();
