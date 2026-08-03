import {
  newTargetState,
  evaluateChallenge,
  recordPrompt,
  recordResult,
  GLOBAL_COOLDOWN_MS,
  OBVIOUSLY_HUMAN_MS,
} from '../../src/players/peer-challenge';
import { DEDUCTION } from '../../src/players/reputation';

const T0 = Date.UTC(2026, 6, 15, 12, 0, 0);

describe('peer challenge — global 60-minute cooldown', () => {
  it('a second challenger within the hour is silently auto-passed, not shown a popup', () => {
    const s = newTargetState();
    // Challenger A prompts the target.
    expect(evaluateChallenge(s, 'A', T0).outcome).toBe('PROMPT');
    recordPrompt(s, 'A', T0);
    // Challenger B, 10 minutes later → within the window → auto-pass (no wolf-pack popups).
    const b = evaluateChallenge(s, 'B', T0 + 10 * 60_000);
    expect(b.outcome).toBe('AUTO_PASS');
    // After 60 minutes, a fresh challenger sees a popup again.
    expect(evaluateChallenge(s, 'C', T0 + GLOBAL_COOLDOWN_MS + 1).outcome).toBe('PROMPT');
  });
});

describe('peer challenge — one challenge per target per day per challenger', () => {
  it('the same challenger cannot re-challenge the same target that day', () => {
    const s = newTargetState();
    recordPrompt(s, 'A', T0);
    recordResult(s, 'A', { passed: true, responseMs: 30_000 }, T0); // passed slowly, no blowback
    // Same day, well after the protection window → still rejected for A specifically.
    const again = evaluateChallenge(s, 'A', T0 + 2 * GLOBAL_COOLDOWN_MS);
    expect(again.outcome).toBe('REJECTED');
    expect(again).toMatchObject({ reason: expect.stringMatching(/per target per day/) });
  });
});

describe('peer challenge — post-pass protection + race fix', () => {
  it('after passing, challenges in the next hour are auto-passed', () => {
    const s = newTargetState();
    recordPrompt(s, 'A', T0);
    recordResult(s, 'A', { passed: true, responseMs: 20_000 }, T0);
    // A different challenger, 30 min later → protected → auto-pass.
    expect(evaluateChallenge(s, 'B', T0 + 30 * 60_000).outcome).toBe('AUTO_PASS');
  });

  it('protection = max(prompt+60, pass+60): a late pass extends the window (race fix)', () => {
    const s = newTargetState();
    recordPrompt(s, 'A', T0); // prompt window ends at T0+60m
    // The pass lands at T0+59m → pass window ends at T0+119m, which must win.
    recordResult(s, 'A', { passed: true, responseMs: 20_000 }, T0 + 59 * 60_000);
    // At T0+61m the prompt window has closed, but the pass window protects → auto-pass.
    expect(evaluateChallenge(s, 'B', T0 + 61 * 60_000).outcome).toBe('AUTO_PASS');
  });
});

describe('peer challenge — blowback against spite-challenging', () => {
  it('if the target passes in under 10s, that challenger is blocked for the day', () => {
    const s = newTargetState();
    recordPrompt(s, 'A', T0);
    recordResult(s, 'A', { passed: true, responseMs: OBVIOUSLY_HUMAN_MS - 1 }, T0); // obviously human
    // Even long after the protection window, A cannot challenge this target again today.
    const blocked = evaluateChallenge(s, 'A', T0 + 5 * GLOBAL_COOLDOWN_MS);
    expect(blocked.outcome).toBe('REJECTED');
    expect(blocked).toMatchObject({ reason: expect.stringMatching(/verified human/) });
  });
});

describe('peer challenge — failure consequences', () => {
  it('a failed challenge costs 20 reputation, restricts the table next round, and alerts ops', () => {
    const s = newTargetState();
    recordPrompt(s, 'A', T0);
    const c = recordResult(s, 'A', { passed: false, responseMs: 45_000 }, T0);
    expect(c.reputationDelta).toBe(-DEDUCTION.CHALLENGE_FAIL);
    expect(c.restrictFromTableNextRound).toBe(true);
    expect(c.notifyOps).toBe(true);
  });

  it('a passing challenge costs nothing', () => {
    const s = newTargetState();
    recordPrompt(s, 'A', T0);
    const c = recordResult(s, 'A', { passed: true, responseMs: 25_000 }, T0);
    expect(c.reputationDelta).toBe(0);
    expect(c.restrictFromTableNextRound).toBe(false);
  });
});
