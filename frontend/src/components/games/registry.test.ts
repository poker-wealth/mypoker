import { describe, it, expect } from 'vitest';
import { feltFor, GAME_FELTS } from './registry';

/**
 * EVERY NON-POKER TABLE MUST HAVE ITS OWN SCREEN.
 *
 * This registry has been lost to a merge twice. Main's copy of Table.tsx has no felts in it, so
 * resolving a conflict in main's favour silently dropped the whole mapping — and nothing failed.
 * The app built, every route loaded, and every game quietly rendered the Hold'em table instead of
 * its own: baccarat dealing community cards, minesweeper with a dealer button.
 *
 * That is what this pins. It is about routing rather than rendering on purpose — a felt that looks
 * wrong gets reported, whereas the mapping vanishing looks like nothing at all.
 *
 * The ids are written out here rather than read from `LIVE_TABLE_IDS`, because importing config.ts
 * touches `window` at module load and this suite runs in node. So adding a game to the lobby does
 * NOT automatically get covered — add it to both places.
 */
const NON_POKER_TABLES = [
  'baccarat',
  'niu-niu',
  'san-zhang',
  'red-packet',
  'cowboy-beauty',
  'dou-di-zhu',
  'lottery',
  'slots',
  'texas-cowboy',
];

/** The poker family shares the Hold'em felt deliberately, so these have no entry. */
const POKER_TABLES = ['texas', 'texas-high', 'short-deck', 'omaha'];

describe('felt routing', () => {
  it.each(NON_POKER_TABLES)('%s has its own felt, not the poker table', (id) => {
    expect(feltFor(id)).toBeDefined();
  });

  it.each(POKER_TABLES)('%s falls through to the poker table', (id) => {
    expect(feltFor(id)).toBeUndefined();
  });

  it('routes every felt in the registry and nothing else', () => {
    expect(Object.keys(GAME_FELTS).sort()).toEqual([...NON_POKER_TABLES].sort());
  });

  it('gives a practice table the same felt as the game it practises', () => {
    expect(feltFor('niu-niu-ai')).toBe(feltFor('niu-niu'));
  });
});
