import { tableCommandSchema } from '../../src/live/room-state';

/**
 * EVERY GAME'S REAL MOVE HAS TO SURVIVE THE WIRE.
 *
 * The room tests call `room.command(...)` directly, so they never cross `tableCommandSchema` — a
 * boundary that rejects a game's vocabulary leaves that game silently unplayable in the browser
 * while its whole suite stays green. That happened: the schema was tightened to a verb list that
 * had no baccarat spots, no grid cells, no lottery numbers and no `bid-2`, and five games broke
 * where no test was looking.
 *
 * So: one real command per game, exactly as the felt sends it. Change the schema and this tells
 * you which games you just took off the table.
 */

const REAL_COMMANDS: Array<[string, unknown]> = [
  ['poker · check', { kind: 'act', action: { type: 'check' } }],
  ['poker · raise', { kind: 'act', action: { type: 'raise', amount: 120 } }],
  ['baccarat · back the player', { kind: 'act', action: { type: 'player', amount: 100 } }],
  ['baccarat · back the tie', { kind: 'act', action: { type: 'tie', amount: 100 } }],
  ['niu niu · stake', { kind: 'act', action: { type: 'bet', amount: 100 } }],
  ['niu niu · stake at 5x', { kind: 'act', action: { type: 'bet', amount: 100, multiplier: 5 } }],
  ['niu niu · bid 1x for the bank', { kind: 'act', action: { type: 'bid-1' } }],
  ['niu niu · bid 5x for the bank', { kind: 'act', action: { type: 'bid-5' } }],
  ['san zhang · stake', { kind: 'act', action: { type: 'bet', amount: 100 } }],
  ['red packet · pick cell 3', { kind: 'act', action: { type: '3', amount: 100 } }],
  ['red packet · pick cell 24', { kind: 'act', action: { type: '24', amount: 100 } }],
  ['cowboy & beauty · a side', { kind: 'act', action: { type: 'cowboy', amount: 100 } }],
  ['lottery · a number', { kind: 'act', action: { type: '7', amount: 100 } }],
  ['dou di zhu · bid 2', { kind: 'act', action: { type: 'bid-2' } }],
  ['dou di zhu · pass the auction', { kind: 'act', action: { type: 'bid-0' } }],
  ['dou di zhu · play a combination', { kind: 'act', action: { type: 'play', cards: ['3s', '3h'] } }],
  ['dou di zhu · pass the trick', { kind: 'act', action: { type: 'pass' } }],
  ['slots · spin', { kind: 'act', action: { type: 'spin', amount: 100 } }],
  ['practice · AI difficulty', { kind: 'act', action: { type: 'ai-hard' } }],
];

describe('the wire speaks every game', () => {
  it.each(REAL_COMMANDS)('accepts %s', (_label, command) => {
    const parsed = tableCommandSchema.safeParse(command);
    expect(parsed.success).toBe(true);
  });

  it('keeps the stake multiplier, which decides how much money moves', () => {
    // Dropped, a 5x stake settles at 1x and the bank keeps four fifths of what it owed.
    const parsed = tableCommandSchema.safeParse({
      kind: 'act',
      action: { type: 'bet', amount: 100, multiplier: 5 },
    });
    expect(parsed.success && parsed.data.kind === 'act' && parsed.data.action.multiplier).toBe(5);
  });

  it('keeps the played cards, which belong INSIDE the action', () => {
    // Hung off the command instead, they are stripped and the room sees a play with no cards in it.
    const parsed = tableCommandSchema.safeParse({
      kind: 'act',
      action: { type: 'play', cards: ['3s', '3h'] },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.kind === 'act' && parsed.data.action.cards).toEqual([
      '3s',
      '3h',
    ]);
  });

  it('still refuses a shape no game speaks', () => {
    for (const junk of ['', 'give-me-money', 'DROP TABLE', 'bid-9', '1234']) {
      expect(tableCommandSchema.safeParse({ kind: 'act', action: { type: junk } }).success).toBe(
        false,
      );
    }
  });
});
