import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
 * THE TABLE LIST IS READ FROM THE SERVER, not written out here. It used to be a hardcoded array
 * whose own comment admitted the hole: "adding a game to the lobby does NOT automatically get
 * covered — add it to both places." That is the same assume-don't-enumerate failure as
 * docs/TRAPS.md #9, and a list that must be updated by hand is a list that drifts. The stated
 * reason for hardcoding was that importing `config.ts` touches `window` at module load; reading
 * the server's source as TEXT avoids that without giving up the coupling.
 */

const SERVER_TABLES = fileURLToPath(
  new URL('../../../../game-server/src/live/server.ts', import.meta.url),
);

/** `{ ... id: 'x', ... game: 'y', ... }` entries inside `defaultTables()`. */
function serverTables(): { id: string; game: string }[] {
  const src = readFileSync(SERVER_TABLES, 'utf8');
  const start = src.indexOf('export function defaultTables()');
  if (start === -1) throw new Error('defaultTables() not found — update this test, do not delete it');
  // Scoped to the RETURNED ARRAY, not the whole function. Slicing the function
  // body meant its own opening brace never closed inside the slice, so the
  // object scan below never completed one and silently produced nothing.
  const open = src.indexOf('[', src.indexOf('return', start));
  if (open === -1) throw new Error('defaultTables() has no array literal — update this test');
  let d = 0;
  let close = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') d++;
    else if (src[i] === ']' && --d === 0) {
      close = i;
      break;
    }
  }
  if (close === -1) throw new Error('defaultTables() array is unterminated — update this test');
  const body = src.slice(open + 1, close);

  // Per OBJECT, not per line. A line-based scan quietly missed `texas-high`,
  // whose `id` and `game` sit on separate lines because that entry is written
  // across several — and the count assertion below is what caught it.
  const out: { id: string; game: string }[] = [];
  let depth = 0;
  let chunk = '';
  for (const ch of body) {
    if (ch === '{') {
      depth++;
      if (depth === 1) chunk = '';
    }
    if (depth >= 1) chunk += ch;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const id = /\bid:\s*'([^']+)'/.exec(chunk);
        const game = /\bgame:\s*'([^']+)'/.exec(chunk);
        if (id && game) out.push({ id: id[1], game: game[1] });
      }
    }
  }
  return out;
}

const tables = serverTables();

/** The poker family shares the Hold'em felt deliberately, so these have no entry. */
const POKER_GAMES = new Set(['texas', 'short-deck', 'omaha']);

const nonPoker = tables.filter((t) => !POKER_GAMES.has(t.game)).map((t) => t.id);
const poker = tables.filter((t) => POKER_GAMES.has(t.game)).map((t) => t.id);

describe('felt routing', () => {
  it('actually parsed the server table list', () => {
    // Without this, a parse that silently returned [] would make every `it.each`
    // below vacuous and the suite would pass green having checked nothing —
    // docs/TRAPS.md #1.
    expect(tables.length).toBeGreaterThanOrEqual(13);
    expect(nonPoker.length).toBeGreaterThanOrEqual(9);
    expect(poker.length).toBeGreaterThanOrEqual(4);
  });

  it.each(nonPoker)('%s has its own felt, not the poker table', (id) => {
    expect(feltFor(id)).toBeDefined();
  });

  it.each(poker)('%s falls through to the poker table', (id) => {
    expect(feltFor(id)).toBeUndefined();
  });

  it('routes every felt in the registry and nothing else', () => {
    expect(Object.keys(GAME_FELTS).sort()).toEqual([...nonPoker].sort());
  });

  it('gives a practice table the same felt as the game it practises', () => {
    expect(feltFor('niu-niu-ai')).toBe(feltFor('niu-niu'));
  });
});
