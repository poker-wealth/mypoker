import { createHash } from 'node:crypto';
import { INJECTION_BPS, TIER_CONFIG } from '../jackpot/tiers';
import { GAME_CATALOG, type GameId } from '../lobby/game-catalog';

/**
 * The rule-version stamp — the missing half of the public RTP feed (queue #12).
 *
 * WHY THIS EXISTS
 *
 * A published payout rate is only meaningful if the rules that produced it were
 * fixed in advance. Otherwise "96.8%" is a number the platform asserts about
 * itself, and Fairness.tsx said so in as many words while deliberately leaving
 * the rates blank rather than print something unverifiable.
 *
 * So: hash the rules that decide who gets paid what, commit that hash on-chain,
 * and stamp every settled round with the version it ran under. A player can then
 * check three things independently — the rules were committed BEFORE their hand
 * (chain timestamp), their hand cites that version (round record), and the rate
 * published for that version covers a stated number of rounds.
 *
 * WHAT IS IN THE MANIFEST
 *
 * Only what changes a payout. Deliberately NOT: table stakes (per-table, not a
 * rule), seat counts, or display names. Adding a field changes every version
 * hash, which is correct — it means the rules changed — but it also means the
 * manifest must contain rules and nothing else, or a cosmetic rename would
 * announce itself as a rule change and destroy the signal.
 *
 * WHAT THIS DOES NOT CLAIM
 *
 * The version is stored ON each round, not folded into the round's own hash.
 * Folding it in would change `computeRoundHash`, which is the v6.0 verifier
 * contract: every already-notarized round would stop verifying. So the stamp is
 * published and auditable — the rules are anchored on-chain in their own right,
 * with a timestamp that precedes the rounds citing them — but a round's leaf
 * hash does not itself commit to the version. Closing that last gap is a
 * verifier-contract change and belongs with whoever owns the 6-step verifier.
 */

/** Payout-affecting rules for one game. Everything here changes what a player receives. */
export interface GameRules {
  gameId: GameId;
  /** Platform cut of winner profit, basis points. */
  rakeBps: number;
  /** Jackpot injection from winner profit, basis points (§5). */
  jackpotBps: number;
  /** Game-specific payout parameters — empty when the game has none. */
  paytable: Readonly<Record<string, number>>;
}

export interface RuleManifest {
  /** Content hash over the canonical form. Changes if and only if a rule changes. */
  version: string;
  /** Manifest schema revision — bumped by hand if the SHAPE changes, so a
   *  version hash can never be ambiguous about what it was hashing. */
  manifestRevision: number;
  games: GameRules[];
}

const MANIFEST_REVISION = 1;

/**
 * The platform-default poker rake. Lives HERE (not in poker-room.ts) so the
 * manifest can use it without importing from live/ — poker-room imports this
 * module, and the reverse edge would be a cycle. `DEFAULT_ROOM` spreads it, so
 * there is exactly one copy of the default and the published manifest can never
 * silently disagree with the table that runs it.
 */
export const DEFAULT_POKER_RAKE = { bps: 500, cap: 600, noFlopNoDrop: true } as const;

/** The four jackpot tiers' payout-affecting numbers, shared by every poker game. */
function pokerJackpotPaytable(): Record<string, number> {
  return Object.fromEntries(
    (Object.keys(TIER_CONFIG) as (keyof typeof TIER_CONFIG)[]).flatMap((tier) => [
      [`jackpot.${tier}.injectionBps`, TIER_CONFIG[tier].injectionBps],
      [`jackpot.${tier}.payoutBps`, TIER_CONFIG[tier].payoutBps],
    ]),
  );
}

/**
 * The payout-affecting rules of ONE live poker table, in exactly the shape the
 * manifest publishes for that game.
 *
 * This shared constructor is the fix for the audit's central finding: the room
 * used to hash `{rakeCap, noFlopNoDrop}` while the manifest hashed the jackpot
 * splits — same game, two incompatible hashings, so the version the feed
 * published could never equal the version any round stamped, and the round's
 * stamp was an opaque hash nobody could re-derive. Built through ONE function,
 * a default table's version IS the published per-game version, and a custom
 * table's version re-derives from its config the same way.
 */
export function pokerTableRules(cfg: {
  variantId: 'texas' | 'short-deck' | 'omaha';
  // noFlopNoDrop optional to match RakeConfig: unset means false, and the two
  // must hash identically because they ARE the same rule.
  rake: { bps: number; cap: number; noFlopNoDrop?: boolean | undefined };
}): GameRules {
  return {
    gameId: cfg.variantId,
    rakeBps: cfg.rake.bps,
    // The rate the jackpot engine actually injects at — imported, not a
    // literal, so the stamp cannot silently diverge from the engine.
    jackpotBps: INJECTION_BPS,
    paytable: {
      ...pokerJackpotPaytable(),
      rakeCap: cfg.rake.cap,
      noFlopNoDrop: cfg.rake.noFlopNoDrop ? 1 : 0,
    },
  };
}

/**
 * Default rake, in basis points, per game.
 *
 * These mirror the values the live rooms are configured with (`DEFAULT_ROOM.rake`
 * is 500 for poker) and the adapters' commission. A table may be configured
 * differently — a league table, a promotional table — and when it is, its rounds
 * carry a DIFFERENT version, which is exactly the point: the stamp describes the
 * rules a hand actually ran under, not the rules we hoped it ran under.
 */
const DEFAULT_RAKE_BPS: Readonly<Record<string, number>> = {
  texas: 500,
  'short-deck': 500,
  omaha: 500,
  baccarat: 500,
  'niu-niu': 500,
  'dou-di-zhu': 500,
  'san-zhang': 500,
  'red-packet': 250,
  'cowboy-beauty': 500,
  lottery: 250,
  slots: 500,
  'texas-cowboy': 500,
};

/** Payout parameters that are not simply a rake. */
const PAYTABLES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  // Baccarat's tie bet pays 8:1 (the room's configured `tiePayout`).
  baccarat: { tiePayout: 8 },
};

/**
 * Canonical JSON: keys sorted at every level, no whitespace.
 *
 * The hash must not move because a field was declared in a different order, or
 * two identical rule sets would announce themselves as different versions.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/** The rules currently in force, with their content hash. */
export function currentRuleManifest(): RuleManifest {
  const POKER = new Set(['texas', 'short-deck', 'omaha']);
  const games: GameRules[] = (Object.keys(GAME_CATALOG) as GameId[])
    .slice()
    .sort()
    .map((gameId) =>
      POKER.has(gameId)
        ? pokerTableRules({
            variantId: gameId as 'texas' | 'short-deck' | 'omaha',
            rake: DEFAULT_POKER_RAKE,
          })
        : {
            gameId,
            rakeBps: DEFAULT_RAKE_BPS[gameId] ?? 0,
            jackpotBps: INJECTION_BPS,
            paytable: PAYTABLES[gameId] ?? {},
          },
    );

  const body = { manifestRevision: MANIFEST_REVISION, games };
  const version = createHash('sha256').update(canonical(body)).digest('hex');
  return { version, manifestRevision: MANIFEST_REVISION, games };
}

/**
 * The version hash for ONE table's actual configuration.
 *
 * A table running a non-default rake is not running the published rules, and
 * saying otherwise would be the exact dishonesty this feature exists to remove.
 */
export function ruleVersionFor(rules: GameRules): string {
  const body = { manifestRevision: MANIFEST_REVISION, games: [rules] };
  return createHash('sha256').update(canonical(body)).digest('hex');
}
