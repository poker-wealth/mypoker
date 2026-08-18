import { DouDiZhuGame } from '../../../src/games/dou-di-zhu/dou-di-zhu-game';
import { EventBus } from '../../../src/core/event-bus';
import { FakeChainClient, computeFinalSeed, serverCommitOf } from '../../../src/fairness';
import type { FinancialCoreClient } from '../../../src/core/financial-core-client';

/**
 * THE JACKPOT MUST DRAW ON THE SEED THE CARDS CAME FROM.
 *
 * Dou Di Zhu computed a provably-fair seed, shuffled with it, and threw it away — so the room fed
 * the jackpot `${roundId}:seed` instead. A round id is not a secret: anyone who could read one
 * could compute that string, and therefore work out ahead of time whether a jackpot would fire.
 * That is a real-money fairness bug, not an untidiness.
 *
 * These pin the properties that make the draw honest: the seed exists, it is the one the deck was
 * shuffled with, it is not derivable from the round id, it changes every deal, and it can be
 * recomputed from its published parts by anyone who wants to check.
 */

const fc = {} as FinancialCoreClient;

function newGame(): DouDiZhuGame {
  return new DouDiZhuGame('ddz-test', fc, new EventBus(), new FakeChainClient(), {
    baseStake: 100,
    rakeBps: 500,
    tableType: 'PLATFORM',
    accountOf: (p: string) => p,
    jackpotAccounts: {
      mini: 'jp:mini',
      minor: 'jp:minor',
      major: 'jp:major',
      grand: 'jp:grand',
    },
  });
}

const PLAYERS = ['alice', 'bob', 'carol'];

describe('Dou Di Zhu — provably-fair round data', () => {
  it('has no round context before the first deal', () => {
    expect(newGame().roundInfo()).toBeUndefined();
  });

  it('keeps the seed the deal was made with', async () => {
    const game = newGame();
    await game.start(PLAYERS);

    const round = game.roundInfo();
    expect(round).toBeDefined();
    expect(round!.finalSeed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not hand out a seed anyone can derive from the round id', async () => {
    const game = newGame();
    await game.start(PLAYERS);
    const round = game.roundInfo()!;

    // The exact string the room used to pass. If the seed is ever this again, the draw is public.
    expect(round.finalSeed).not.toBe(`${round.roundId}:seed`);
    expect(round.finalSeed).not.toContain(round.roundId);
  });

  it('publishes parts that recompute to the same seed', async () => {
    const game = newGame();
    await game.start(PLAYERS);
    const r = game.roundInfo()!;

    // What a player checking the deal would do: hash the commit, then rebuild the final seed.
    expect(serverCommitOf(r.serverSeed)).toBe(r.serverCommit);
    expect(computeFinalSeed(r.serverSeed, r.allClientSeeds, r.futureBlockHash, r.roundId)).toBe(
      r.finalSeed,
    );
  });

  it('draws a fresh seed for every deal', async () => {
    const game = newGame();
    const seeds = new Set<string>();
    const ids = new Set<string>();

    for (let i = 0; i < 5; i++) {
      await game.start(PLAYERS);
      const r = game.roundInfo()!;
      seeds.add(r.finalSeed);
      ids.add(r.roundId);
    }

    // Five deals, five distinct seeds — a repeat would mean a repeatable shuffle.
    expect(seeds.size).toBe(5);
    expect(ids.size).toBe(5);
  });
});
