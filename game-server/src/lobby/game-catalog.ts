/**
 * The catalogue of playable games.
 *
 * `fairness` is deliberately part of the public metadata, not a marketing string:
 *
 *   PROVABLE         — we own the rules. Every round is verifiable, and (from the public fairness
 *                      feed) the rules themselves are committed on-chain, so they cannot be quietly
 *                      retuned. We can honestly claim these are tamper-proof.
 *   VENDOR_ATTESTED  — an outside vendor owns the rules. Our boundary forces them to sign every
 *                      round, so they cannot lie about an individual result, but we cannot prove
 *                      their paytable was never changed. We must NOT claim these are tamper-proof.
 *
 * A vendor moves up to PROVABLE only by committing its config hash on-chain. Labelling this in the
 * data — rather than in a slide — is what keeps the transparency claim true as the catalogue grows.
 */

export type GameId =
  | 'texas'
  | 'short-deck'
  | 'omaha'
  | 'baccarat'
  | 'niu-niu'
  | 'dou-di-zhu'
  | 'san-zhang'
  | 'red-packet'
  | 'cowboy-beauty'
  | 'lottery'
  | 'slots';

export type FairnessTier = 'PROVABLE' | 'VENDOR_ATTESTED';

export interface GameSpec {
  id: GameId;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  fairness: FairnessTier;
  /** Set when an outside vendor supplies the outcome. */
  vendor?: string;
}

/**
 * Minimums match the shipped engines. Note two deliberate deviations from the spec, which lists
 * Baccarat and Cowboy & Beauty as "min 1 (vs dealer)": we are never the dealer or the banker, so
 * both are player-banked/pari-mutuel and need a real counterparty — minimum 2.
 */
export const GAME_CATALOG: Readonly<Record<GameId, GameSpec>> = {
  texas: { id: 'texas', name: "Texas Hold'em", minPlayers: 2, maxPlayers: 9, fairness: 'PROVABLE' },
  'short-deck': { id: 'short-deck', name: "Short Deck Hold'em", minPlayers: 2, maxPlayers: 9, fairness: 'PROVABLE' },
  omaha: { id: 'omaha', name: 'Omaha', minPlayers: 2, maxPlayers: 9, fairness: 'PROVABLE' },
  baccarat: { id: 'baccarat', name: 'Baccarat', minPlayers: 2, maxPlayers: 12, fairness: 'PROVABLE' },
  'niu-niu': { id: 'niu-niu', name: 'Niu Niu', minPlayers: 3, maxPlayers: 10, fairness: 'PROVABLE' },
  'dou-di-zhu': { id: 'dou-di-zhu', name: 'Dou Di Zhu', minPlayers: 3, maxPlayers: 3, fairness: 'PROVABLE' },
  'san-zhang': { id: 'san-zhang', name: 'San Zhang', minPlayers: 2, maxPlayers: 9, fairness: 'PROVABLE' },
  'red-packet': { id: 'red-packet', name: 'Red Packet Minesweeper', minPlayers: 2, maxPlayers: 20, fairness: 'PROVABLE' },
  'cowboy-beauty': { id: 'cowboy-beauty', name: 'Cowboy & Beauty', minPlayers: 2, maxPlayers: 50, fairness: 'PROVABLE' },
  lottery: { id: 'lottery', name: 'Lottery', minPlayers: 2, maxPlayers: 10_000, fairness: 'PROVABLE' },
  slots: { id: 'slots', name: 'Slots', minPlayers: 1, maxPlayers: 1, fairness: 'PROVABLE' },
};

export const GAME_IDS = Object.keys(GAME_CATALOG) as GameId[];

export function gameSpec(id: GameId): GameSpec {
  const spec = GAME_CATALOG[id];
  if (!spec) throw new RangeError(`unknown game: ${id}`);
  return spec;
}

/** Games we can honestly advertise as tamper-proof (rules committed, not just results signed). */
export function provableGames(): GameSpec[] {
  return GAME_IDS.map(gameSpec).filter((g) => g.fairness === 'PROVABLE');
}

/**
 * Swap a game to an outside vendor's implementation. It drops to VENDOR_ATTESTED unless the vendor
 * commits its config hash on-chain — which is exactly the question to put to any supplier.
 */
export function withVendor(
  id: GameId,
  vendor: string,
  opts: { commitsConfigHash: boolean },
): GameSpec {
  return {
    ...gameSpec(id),
    vendor,
    fairness: opts.commitsConfigHash ? 'PROVABLE' : 'VENDOR_ATTESTED',
  };
}
