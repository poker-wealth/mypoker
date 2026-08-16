import { describe, expect, it } from 'vitest';
import { DEMO_SCRIPTS } from './scripts';

/**
 * THROWAWAY DEMO — checks the walkthrough is coherent before anyone shows it to a room.
 *
 * The screens are fed these snapshots directly, so a malformed one is a broken demo in front of an
 * audience. Cheap insurance: every game present, every step readable, every round ending in a
 * result rather than trailing off.
 */

const CATALOGUE = [
  'texas',
  'baccarat',
  'niu-niu',
  'san-zhang',
  'dou-di-zhu',
  'red-packet',
  'cowboy-beauty',
  'lottery',
  'slots',
];

describe('the demo walkthrough', () => {
  it('covers every game', () => {
    expect(DEMO_SCRIPTS.map((s) => s.tableId).sort()).toEqual([...CATALOGUE].sort());
  });

  it.each(DEMO_SCRIPTS.map((s) => [s.title, s] as const))('%s reads as a round', (_title, script) => {
    expect(script.premise.length).toBeGreaterThan(20);
    expect(script.steps.length).toBeGreaterThanOrEqual(2);

    for (const step of script.steps) {
      expect(step.caption.length).toBeGreaterThan(10);
      // Somebody is at the table, and one of them is the viewer.
      expect(step.snapshot.seats.length).toBeGreaterThan(0);
      expect(step.snapshot.seats.some((s) => s.isYou)).toBe(true);
      expect(step.snapshot.tableId).toBe(script.tableId);

      // Nobody sits past the end of the table. The screens build the ring from `maxSeats` and
      // place players at their index, so a seat number beyond it is a player who never appears —
      // and a gap in the numbering is an empty chair in the middle of the round.
      for (const s of step.snapshot.seats) {
        expect(s.index).toBeLessThan(step.snapshot.maxSeats);
      }
      const indices = step.snapshot.seats.map((s) => s.index).sort((a, b) => a - b);
      expect(indices).toEqual(indices.map((_, i) => i));
    }

    // Every walkthrough ends on a settled round with a winner and something to read.
    const last = script.steps.at(-1)!.snapshot;
    expect(last.phase).toBe('SHOWDOWN');
    expect(last.message).toBeTruthy();
    expect(last.seats.some((s) => s.isWinner)).toBe(true);
  });

  it('shows money moving, not just changing', () => {
    for (const script of DEMO_SCRIPTS) {
      const first = script.steps[0]!.snapshot;
      const last = script.steps.at(-1)!.snapshot;
      const you = (s: typeof first) => s.seats.find((x) => x.isYou)!;
      // The viewer's stack ends somewhere other than where it started, or nothing happened.
      expect(you(last).stack).not.toBe(you(first).stack);
    }
  });
});
