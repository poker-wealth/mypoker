import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * NO ROOM MAY DRAW ITS JACKPOT ON A SEED A PLAYER CAN GUESS.
 *
 * Every non-poker room passed `${roundId}:seed` to processJackpot. A round id is not a secret — it
 * appears in snapshots and logs — and the draw is a pure function of the seed, so anyone holding one
 * could work out in advance whether a jackpot would fire and on which tier. Dou Di Zhu was fixed
 * under ESTHER_V2 task 1; it turned out never to be a DDZ bug, but a bug in seven more rooms.
 *
 * This reads the source rather than exercising the rooms, deliberately. The failure is a wrong
 * ARGUMENT at a call site, and a behavioural test would have to make a jackpot actually fire to
 * see it — rare by design, and easy to write a test that passes without ever proving anything.
 * Grepping the call is blunt, but it cannot pass for the wrong reason, and it fails the moment
 * someone reintroduces the pattern in a new room.
 */

const LIVE_DIR = join(__dirname, '../../src/live');

/** A seed built out of the round id — the exact shape of the bug. */
const DERIVED_FROM_ROUND_ID = /processJackpot\([^)]*`\$\{roundId\}[^`]*`/s;

function roomFiles(): string[] {
  return readdirSync(LIVE_DIR).filter((f) => f.endsWith('-room.ts'));
}

/** Source with block and line comments stripped, so prose about the bug is not mistaken for it. */
function codeOf(file: string): string {
  return readFileSync(join(LIVE_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('jackpot seeds', () => {
  const files = roomFiles();

  it('finds the rooms to check', () => {
    // Guards the guard: an empty list would make every case below pass vacuously.
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('%s does not derive its jackpot seed from the round id', (file) => {
    expect(codeOf(file)).not.toMatch(DERIVED_FROM_ROUND_ID);
  });

  it('every room that draws a jackpot passes a seed from the game itself', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = codeOf(file);
      const calls = code.match(/processJackpot\([^;]*\)/gs) ?? [];
      for (const call of calls) {
        // base-room declares the method; only the rooms that CALL it are under test here. A
        // declaration is recognisable by its typed parameters.
        if (/\b\w+:\s*(number|string)\b/.test(call)) continue;

        // The seed is the third argument. It has to come from the round — the engine's own seed,
        // or the provider's per-round seed — not from anything the client already knows.
        const fromTheGame = /roundSeed|finalSeed|serverSeed|jackpotSeed/.test(call);
        if (!fromTheGame) offenders.push(`${file}: ${call.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
