import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM, PokerRoom, type PokerRoomConfig } from '../../src/live/poker-room';
import { MAX_VOICE_BYTES } from '../../src/social/voice';

/**
 * Voice notes AT THE ROOM (SAMUEL_V2 task 2).
 *
 * The unit tests in test/social/voice.test.ts prove the rules. This file proves
 * the thing the task actually asks for: that a voice note reaches the table,
 * and that a bad one cannot disturb the hand being played.
 *
 * "A voice error must never affect the game" is not a slogan here — it is the
 * reason the caps exist at all. The clip rides the same socket as every bet, so
 * the failure mode being defended against is a player losing their connection
 * mid-hand because someone held the microphone too long.
 */

const FAST: Omit<PokerRoomConfig, 'id' | 'name'> = {
  ...DEFAULT_ROOM,
  maxSeats: 6,
  handStartDelayMs: 10,
  showdownDelayMs: 10,
  actionTimeoutMs: 80,
  disconnectGraceMs: 20,
  spectatorDelayMs: 0,
};

const wait = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await wait(5);
  }
  throw new Error('timed out');
}

const clipOf = (bytes: number): string => Buffer.alloc(bytes, 7).toString('base64');
const VOICE = { kind: 'voice' as const, clip: clipOf(4096), durationMs: 3_000, mime: 'audio/webm;codecs=opus' };

interface Seen { event: string; data: unknown }

function harness(overrides: Partial<PokerRoomConfig> = {}) {
  const players = new DevPlayers({ startingChips: 10_000 });
  const bank = new ChipBank(players);
  const alice = players.create('Alice').id;
  const bob = players.create('Bob').id;
  const room = new PokerRoom(
    { ...FAST, id: 'v1', name: 'Voice table', ...overrides } as PokerRoomConfig,
    { directory: players, fc: bank },
  );
  return { room, players, alice, bob };
}

/** Attach a viewer that records what the room pushes to it. */
function watch(room: PokerRoom, playerId: string): Seen[] {
  const seen: Seen[] = [];
  room.join(playerId, {
    sendSnapshot: () => {},
    sendEvent: (event: string, data: unknown) => seen.push({ event, data }),
  });
  return seen;
}

describe('voice notes reach the table', () => {
  it('fans a clip out to everyone watching', async () => {
    const h = harness();
    const heardByBob = watch(h.room, h.bob);
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');

    await h.room.command(h.alice, VOICE);

    const note = heardByBob.find((s) => s.event === 'voice_message');
    expect(note).toBeDefined();
    expect(note!.data).toMatchObject({
      senderId: h.alice,
      senderName: 'Alice',
      clip: VOICE.clip,
      durationMs: VOICE.durationMs,
      mime: VOICE.mime,
    });
  });

  it('carries the clip verbatim — the room relays, it does not re-encode', async () => {
    const h = harness();
    const heard = watch(h.room, h.bob);
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');

    const clip = clipOf(MAX_VOICE_BYTES);
    await h.room.command(h.alice, { ...VOICE, clip });

    // Byte-identical, and nothing was stored anywhere to make that true.
    expect((heard.find((s) => s.event === 'voice_message')!.data as { clip: string }).clip).toBe(clip);
  });
});

describe('a bad voice note cannot disturb the hand', () => {
  /**
   * Each of these is refused, and after the refusal the table must still be
   * dealing, both players must still be seated, and normal play must continue.
   * That is the isolation rule stated as a test rather than as a comment.
   */
  it.each([
    ['oversized', { ...VOICE, clip: clipOf(MAX_VOICE_BYTES + 1) }],
    ['too long', { ...VOICE, durationMs: 60_000 }],
    ['a fumbled press', { ...VOICE, durationMs: 10 }],
    ['an unknown container', { ...VOICE, mime: 'application/javascript' }],
  ])('%s is refused and the hand plays on', async (_label, bad) => {
    const h = harness();
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');

    await expect(h.room.command(h.alice, bad)).rejects.toThrow(/Voice denied/);

    // The table is untouched: still in the hand, both seats occupied, and the
    // player who sent the bad clip can still act.
    const view = h.room.snapshotFor(h.alice);
    expect(view.phase).toBe('IN_HAND');
    expect(view.seats.filter((s) => s !== null)).toHaveLength(2);

    const toAct = view.toActSeat;
    expect(toAct).not.toBeNull();
    const actor = toAct === 0 ? h.alice : h.bob;
    const legal = h.room.snapshotFor(actor).legal!;
    await expect(
      h.room.command(actor, { kind: 'act', action: legal.canCheck ? { type: 'check' } : { type: 'call' } }),
    ).resolves.not.toThrow();
  });

  it('a refused clip is never fanned out to anyone else', async () => {
    const h = harness();
    const heardByBob = watch(h.room, h.bob);
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');

    await expect(
      h.room.command(h.alice, { ...VOICE, mime: 'text/html' }),
    ).rejects.toThrow(/Voice denied/);

    // Nobody else even learns it was attempted — a rejection is between the
    // room and the sender.
    expect(heardByBob.filter((s) => s.event === 'voice_message')).toHaveLength(0);
  });

  it('a spectator cannot voice into a live hand', async () => {
    const h = harness();
    const carol = h.players.create('Carol').id;
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');

    // Carol is watching, not seated — the same rule that stops her typing.
    await expect(h.room.command(carol, VOICE)).rejects.toThrow(/SPECTATORS_CANNOT_CHAT/);
  });
});
