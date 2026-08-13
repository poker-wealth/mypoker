import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { BaccaratRoom } from '../../src/live/baccarat-room';
import { RoomError } from '../../src/live/base-room';

describe('Banker Exposure Cap & Room Overdraw Protection', () => {
  it('rejects bets that exceed banker stack capacity and prevents room wedging', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const banker = players.create('Banker').id;
    const bettor = players.create('Bettor').id;

    const room = new BaccaratRoom(
      {
        id: 'baccarat-exp-1',
        name: 'Test Baccarat Exposure',
        game: 'baccarat',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        tiePayout: 8,
        bettingTimeMs: 15_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    // Banker sits with 1,000 chips; Bettor sits with 5,000 chips
    await room.command(banker, { kind: 'sit', seat: 0, buyIn: 1_000 });
    await room.command(bettor, { kind: 'sit', seat: 1, buyIn: 5_000 });

    // Bettor attempts to bet 5,000 against a 1,000 banker stack
    await expect(
      room.command(bettor, { kind: 'act', action: { type: 'player', amount: 5_000 } }),
    ).rejects.toThrow(RoomError);

    // Room is NOT wedged — bettor can place a valid 500 chip bet within banker capacity
    await room.command(bettor, { kind: 'act', action: { type: 'player', amount: 500 } });

    const snap = room.snapshotFor(bettor);
    expect(snap.seats.find((s) => s.playerId === bettor)?.bet).toBe(500);

    // Multi-bettor aggregate exposure test: second bettor attempting to bet 600 (500 + 600 > 1000 banker stack) must be rejected!
    const bettor2 = players.create('Bettor2').id;
    await room.command(bettor2, { kind: 'sit', seat: 2, buyIn: 5_000 });
    await expect(
      room.command(bettor2, { kind: 'act', action: { type: 'player', amount: 600 } }),
    ).rejects.toThrow(RoomError);

    room.dispose();
  });
});
