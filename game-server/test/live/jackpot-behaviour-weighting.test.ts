import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BehaviorTracker } from '../../src/players/behavior-tracker';

/**
 * A JACKPOT DRAW MUST READ THE SEAT'S REAL BEHAVIOUR.
 *
 * The weighting module was wired up and then fed a constant: every candidate went in as `NORMAL`,
 * so a bot and a person had exactly the same chance at a jackpot. The scoring existed and decided
 * nothing — the kind of defect that looks finished from the outside, because the code is all there.
 *
 * ESTHER_V2 task 5 is the input side of that: the room already records reaction time and bet
 * sizing per turn, and `behaviorStatusFor()` turns them into NORMAL or FLAGGED. The whole change is
 * one argument at the candidates map, which is exactly the sort of line that gets quietly reverted
 * in a merge and takes the anti-bot weighting back to decorative with nothing failing.
 *
 * So this pins two things: that the call site reads the seat, and that the tracker it reads can
 * actually return FLAGGED — a wire to something that never fires would be no better than the stub.
 */

const POKER_ROOM = join(__dirname, '../../src/live/poker-room.ts');

/** Source with comments stripped, so prose about the old stub is not mistaken for the stub. */
function code(): string {
  return readFileSync(POKER_ROOM, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('jackpot candidates carry real behaviour', () => {
  it('reads the seat rather than hard-coding NORMAL', () => {
    const src = code();
    expect(src).toMatch(/behavior:\s*this\.behaviorStatusFor\(playerId\)/);
    // The exact stub this replaced. Its return would make the anti-bot score decide nothing.
    expect(src).not.toMatch(/behavior:\s*'NORMAL'/);
  });

  it("leaves association to the pipeline that owns it", () => {
    // COLLUDING and `associated` come from the collusion/association signal, not from per-seat
    // timing. This change must not start asserting them.
    expect(code()).toMatch(/associated:\s*false/);
    expect(code()).not.toMatch(/behavior:\s*'COLLUDING'/);
  });

  it('flags a seat that plays like a machine', () => {
    /**
     * Three tells at once, because no two of them are enough on their own — which is the design,
     * not an obstacle. The weights are fixed-delay 30, perfect-random 30, exact-GTO 20, no-fatigue
     * 20, against a threshold of 60, so a flag always needs corroboration.
     *
     * This seat holds a metronomic 900ms, snaps to an exact half-pot every time, and shows no
     * timing drift across a seventeen-hour session: 30 + 20 + 20 = 70.
     */
    const tracker = new BehaviorTracker();
    const start = 1_700_000_000_000;
    const seventeenHours = 17 * 60 * 60 * 1_000;
    const samples = 40;
    for (let i = 0; i < samples; i++) {
      tracker.record({
        reactionMs: 900,
        betRatio: 0.5,
        at: start + Math.round((i * seventeenHours) / (samples - 1)),
      });
    }
    expect(tracker.status(start + seventeenHours)).toBe('FLAGGED');
  });

  it('does not flag on one tell alone', () => {
    // Metronomic timing over a short session and nothing else is 30 of the 60 needed. Under-flag
    // rather than punish a player who happens to act at a steady pace.
    const tracker = new BehaviorTracker();
    const start = 1_700_000_000_000;
    for (let i = 0; i < 40; i++) {
      tracker.record({ reactionMs: 900, betRatio: null, at: start + i * 30_000 });
    }
    expect(tracker.status(start + 40 * 30_000)).toBe('NORMAL');
  });

  it('leaves an ordinary player alone', () => {
    // Varied timing and varied sizing — a human. A false flag costs real players jackpot weight,
    // so this direction matters as much as the one above.
    const tracker = new BehaviorTracker();
    const start = 1_700_000_000_000;
    const reactions = [1_400, 3_200, 800, 5_600, 2_100, 900, 4_400, 2_800, 6_100, 1_700];
    const ratios = [0.33, 0.75, null, 0.5, null, 1.2, 0.4, null, 0.66, 0.9];
    for (let i = 0; i < 40; i++) {
      tracker.record({
        reactionMs: reactions[i % reactions.length]!,
        betRatio: ratios[i % ratios.length]!,
        at: start + i * 45_000,
      });
    }
    expect(tracker.status(start + 40 * 45_000)).toBe('NORMAL');
  });

  it('says NORMAL on too little evidence', () => {
    // Under-flag rather than misjudge someone on a short sample.
    const tracker = new BehaviorTracker();
    const start = 1_700_000_000_000;
    for (let i = 0; i < 3; i++) {
      tracker.record({ reactionMs: 900, betRatio: 0.5, at: start + i * 30_000 });
    }
    expect(tracker.status(start + 3 * 30_000)).toBe('NORMAL');
  });
});
