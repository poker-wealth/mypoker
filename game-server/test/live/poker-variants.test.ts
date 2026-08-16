import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM, PokerRoom, type PokerRoomConfig } from '../../src/live/poker-room';
import { defaultTables } from '../../src/live/server';
import { TableHub } from '../../src/live/table-hub';
import type { VariantId } from '../../src/games/texas/variants';

/**
 * SHORT DECK + OMAHA — the other two Hold'em variants, hosted by the same `PokerRoom`.
 *
 * The betting, the seating and the settlement rail are shared with Texas and already covered by
 * `poker-room.test.ts`. What is NOT shared, and so is what these tests are for:
 *
 *   - the deck each variant deals from (36 cards for Short Deck, the 2s–5s stripped),
 *   - how many hole cards a player gets (four for Omaha) — and that an opponent's stay hidden
 *     whatever that number is,
 *   - and, per the definition of done, that a hand on each of these tables conserves every chip:
 *
 *         Σ(stacks at the table) + Σ(house sinks) === Σ(what everyone bought in with)
 *
 * Nothing created, nothing destroyed, on the variants as much as on the flagship table.
 */

/** Texas by default, like `DEFAULT_ROOM`; every use below overrides `game` + `variantId` together. */
const FAST: Omit<PokerRoomConfig, 'id' | 'name'> = {
  ...DEFAULT_ROOM,
  maxSeats: 6,
  handStartDelayMs: 10,
  showdownDelayMs: 10,
  actionTimeoutMs: 80,
  disconnectGraceMs: 20,
  spectatorDelayMs: 0,
};

const BUY_IN = 2_000;

const wait = (ms: number): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for a condition, not for a duration — the room is timer-driven. */
async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error('timed out waiting for the table to reach the expected state');
}

interface Harness {
  room: PokerRoom;
  players: DevPlayers;
  bank: ChipBank;
  alice: string;
  bob: string;
  startingTotal: number;
}

function harness(variantId: VariantId): Harness {
  const players = new DevPlayers({ startingChips: 10_000 });
  const bank = new ChipBank(players);
  const alice = players.create('Alice').id;
  const bob = players.create('Bob').id;
  const room = new PokerRoom(
    { ...FAST, id: variantId, name: `${variantId} table`, game: variantId, variantId } as PokerRoomConfig,
    { directory: players, fc: bank },
  );
  return { room, players, bank, alice, bob, startingTotal: players.totalChips() };
}

async function seatBoth(h: Harness): Promise<void> {
  await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
  await h.room.command(h.bob, { kind: 'sit', seat: 3, buyIn: BUY_IN });
  await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');
}

/** Play the hand out with the cheapest legal action, as a bored player would. */
async function playToShowdown(h: Harness, seatOf: Record<number, string>): Promise<void> {
  for (let guard = 0; guard < 200; guard++) {
    const view = h.room.snapshotFor(h.alice);
    if (view.phase !== 'IN_HAND' || view.toActSeat === null) return;
    const playerId = seatOf[view.toActSeat]!;
    const legal = h.room.snapshotFor(playerId).legal!;
    await h.room.command(playerId, {
      kind: 'act',
      action: legal.canCheck ? { type: 'check' } : { type: 'call' },
    });
  }
  throw new Error('hand did not finish');
}

/** Every chip that reached the table is still at the table or in a house sink. */
function expectConserved(h: Harness): void {
  const table = h.room
    .snapshotFor(h.alice)
    .seats.reduce((sum, seat) => sum + seat.stack + seat.bet, 0);
  expect(table + h.bank.sinkTotal()).toBe(2 * BUY_IN);
  // And the wider ledger: locked chips at the table plus everything still in the players' wallets.
  expect(h.players.totalChips() + h.bank.sinkTotal()).toBe(h.startingTotal);
}

describe.each([
  { variantId: 'short-deck' as const, label: 'Short Deck', holeCards: 2, name: "Short Deck Hold'em" },
  { variantId: 'omaha' as const, label: 'Omaha', holeCards: 4, name: 'Omaha' },
])('$label — a live table on PokerRoom', ({ variantId, holeCards, name }) => {
  it(`deals ${holeCards} hole cards and hides the opponent's`, async () => {
    const h = harness(variantId);
    await seatBoth(h);

    const view = h.room.snapshotFor(h.alice);
    expect(view.variant).toBe(name);
    const mine = view.seats.find((s) => s.isYou)!;
    const theirs = view.seats.find((s) => !s.isYou)!;

    expect(mine.cards).toHaveLength(holeCards);
    expect(mine.cards.every((c) => typeof c === 'string')).toBe(true);
    // Face-down, and the right number of backs — the count is public, the cards are not.
    expect(theirs.cards).toEqual(Array.from({ length: holeCards }, () => null));

    const bobsCards = h.room.snapshotFor(h.bob).seats.find((s) => s.isYou)!.cards;
    const visibleToAlice = [
      ...view.board,
      ...view.seats.filter((s) => !s.isYou).flatMap((s) => s.cards),
    ];
    for (const card of bobsCards) expect(visibleToAlice).not.toContain(card);
    h.room.dispose();
  });

  it('plays a full hand and conserves every chip', async () => {
    const h = harness(variantId);
    await seatBoth(h);
    await playToShowdown(h, { 0: h.alice, 3: h.bob });

    const view = h.room.snapshotFor(h.alice);
    expect(view.phase).toBe('SHOWDOWN');
    expect(view.message).toMatch(/wins/);
    expect(view.winners.length).toBeGreaterThan(0);
    expect(view.board).toHaveLength(5);
    // Both hands face-up at showdown, all four cards of them in Omaha.
    for (const seat of view.seats) {
      expect(seat.cards).toHaveLength(holeCards);
      expect(seat.cards.every((c) => typeof c === 'string')).toBe(true);
    }
    expectConserved(h);
    h.room.dispose();
  });

  it('settles hand after hand without leaking a chip', async () => {
    const h = harness(variantId);
    await seatBoth(h);
    await playToShowdown(h, { 0: h.alice, 3: h.bob });
    await until(() => h.room.snapshotFor(h.alice).handNumber === 2);
    await playToShowdown(h, { 0: h.alice, 3: h.bob });
    await until(() => h.room.snapshotFor(h.alice).phase === 'SHOWDOWN');

    expectConserved(h);
    h.room.dispose();
  });
});

describe('Short Deck — the stripped deck', () => {
  it('never deals a card below a six', async () => {
    const h = harness('short-deck');
    await seatBoth(h);
    await playToShowdown(h, { 0: h.alice, 3: h.bob });

    const view = h.room.snapshotFor(h.alice);
    const dealt = [...view.board, ...view.seats.flatMap((s) => s.cards)].filter(
      (c): c is string => typeof c === 'string',
    );
    expect(dealt.length).toBeGreaterThanOrEqual(9); // 5 board + 2 hands of 2
    for (const card of dealt) expect('2345').not.toContain(card[0]);
    h.room.dispose();
  });
});

describe('the tables a deployment opens', () => {
  it('opens a Short Deck and an Omaha table alongside Hold’em', () => {
    const tables = defaultTables();
    const byId = new Map(tables.map((t) => [t.id, t]));

    expect(byId.get('short-deck')).toMatchObject({ game: 'short-deck', variantId: 'short-deck' });
    expect(byId.get('omaha')).toMatchObject({ game: 'omaha', variantId: 'omaha' });
  });

  it('hosts every default table through the hub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );
    // The registry has to know all three ids, or addTable throws — this is the "registered" half
    // of the definition of done, asserted rather than assumed.
    for (const table of defaultTables()) hub.addTable(table);

    // Each table came up with its own variant showing in the lobby row.
    const variants = hub.tables().map((t) => t.variant);
    expect(variants).toEqual(
      expect.arrayContaining(["Texas Hold'em", "Short Deck Hold'em", 'Omaha']),
    );
    await hub.close();
  });

  it('refuses a table whose game and variant disagree', () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    expect(
      () =>
        new PokerRoom(
          { ...FAST, id: 'wrong', name: 'Mislabelled', game: 'omaha', variantId: 'texas' } as PokerRoomConfig,
          { directory: players, fc: new ChipBank(players) },
        ),
    ).toThrow(/must match/);
  });
});
