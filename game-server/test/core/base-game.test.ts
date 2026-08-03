import { BaseGame, InvalidActionError } from '../../src/core/base-game';
import { EventBus } from '../../src/core/event-bus';
import { InvalidTransitionError } from '../../src/core/state-machine';
import type {
  FinancialCoreClient,
  SettleRoundRequest,
  SettlementReceipt,
} from '../../src/core/financial-core-client';

// ── A toy game built ON the framework, used to prove the contract + iron rules ────────────────
type Phase = 'WAITING' | 'IN_PROGRESS' | 'SETTLED';
interface DeclareAction {
  type: 'declare';
  value: number;
}
interface HighCardEvents extends Record<string, unknown> {
  settled: { winner: string };
}

class HighCard extends BaseGame<Phase, DeclareAction, HighCardEvents> {
  readonly minPlayers = 2;
  readonly maxPlayers = 2;
  private players: string[] = [];
  private readonly declarations = new Map<string, number>();

  constructor(
    roomId: string,
    fc: FinancialCoreClient,
    events: EventBus<HighCardEvents>,
    private readonly accountOf: (playerId: string) => string,
  ) {
    super(roomId, fc, events, {
      initial: 'WAITING',
      transitions: { WAITING: ['IN_PROGRESS'], IN_PROGRESS: ['SETTLED'], SETTLED: [] },
    });
  }

  async start(players: string[]): Promise<void> {
    if (players.length !== this.minPlayers) throw new InvalidActionError('need exactly 2 players');
    this.players = [...players];
    for (const p of players) await this.fc.buyIn(this.accountOf(p), '100'); // money via FC only
    this.sm.transition('IN_PROGRESS'); // state via StateMachine only
  }

  async handleAction(playerId: string, action: DeclareAction): Promise<void> {
    // Server validates everything — the client only *requests*.
    if (!this.sm.is('IN_PROGRESS')) throw new InvalidActionError('hand not in progress');
    if (action.type !== 'declare') throw new InvalidActionError('unknown action');
    if (!this.players.includes(playerId)) throw new InvalidActionError('not seated');
    if (this.declarations.has(playerId)) throw new InvalidActionError('already declared');
    this.declarations.set(playerId, action.value);
    if (this.declarations.size === this.players.length) await this.settle();
  }

  private async settle(): Promise<void> {
    const a = this.players[0]!;
    const b = this.players[1]!;
    const winner = this.declarations.get(a)! >= this.declarations.get(b)! ? a : b;
    await this.fc.settleRound({
      roundId: `${this.roomId}-r1`,
      tableType: 'PLATFORM',
      winnerAccountId: this.accountOf(winner),
      winnerProfit: '100',
      rake: '5',
      jackpotAccounts: { mini: 'm', minor: 'n', major: 'j', grand: 'g' },
    });
    this.sm.transition('SETTLED');
    this.events.emit('settled', { winner });
  }

  getPublicState(forPlayerId: string): unknown {
    const revealed = this.sm.is('SETTLED');
    return {
      state: this.state,
      you: this.declarations.get(forPlayerId) ?? null,
      opponents: this.players
        .filter((p) => p !== forPlayerId)
        .map((p) => ({ id: p, value: revealed ? (this.declarations.get(p) ?? null) : null })),
    };
  }
}

function mockFc(): FinancialCoreClient & { calls: { buyIn: string[]; settle: SettleRoundRequest[] } } {
  const calls = { buyIn: [] as string[], settle: [] as SettleRoundRequest[] };
  return {
    calls,
    async buyIn(acc) {
      calls.buyIn.push(acc);
    },
    async release() {},
    async settleRound(req): Promise<SettlementReceipt> {
      calls.settle.push(req);
      return {
        roundId: req.roundId,
        sequence: ['jackpot_inject', 'rake', 'payout'],
        amounts: { jackpot: '0.5', rake: '5', payout: '100' },
        accounts: {},
        hash: 'deadbeef',
      };
    },
    async settleTableHand(req) {
      return { roundId: req.roundId, applied: true };
    },
  };
}

describe('BaseGame contract + three iron rules (toy HighCard game)', () => {
  const acct = (p: string): string => `acc-${p}`;

  it('starts a hand: buys in via the FC and moves state via the StateMachine', async () => {
    const fc = mockFc();
    const game = new HighCard('t1', fc, new EventBus<HighCardEvents>(), acct);
    expect(game.state).toBe('WAITING');
    await game.start(['p1', 'p2']);
    expect(game.state).toBe('IN_PROGRESS');
    expect(fc.calls.buyIn).toEqual(['acc-p1', 'acc-p2']); // money ONLY through FC
  });

  it('the server rejects illegal actions (client cannot drive logic)', async () => {
    const fc = mockFc();
    const game = new HighCard('t1', fc, new EventBus<HighCardEvents>(), acct);
    await expect(game.handleAction('p1', { type: 'declare', value: 5 })).rejects.toThrow(
      InvalidActionError,
    ); // not started yet
    await game.start(['p1', 'p2']);
    await expect(game.handleAction('intruder', { type: 'declare', value: 9 })).rejects.toThrow(
      /not seated/,
    );
    await game.handleAction('p1', { type: 'declare', value: 5 });
    await expect(game.handleAction('p1', { type: 'declare', value: 6 })).rejects.toThrow(
      /already declared/,
    );
  });

  it('settles through the FC, advances to SETTLED, and emits the event', async () => {
    const fc = mockFc();
    const events = new EventBus<HighCardEvents>();
    const settled = jest.fn();
    events.on('settled', settled);
    const game = new HighCard('t1', fc, events, acct);

    await game.start(['p1', 'p2']);
    await game.handleAction('p1', { type: 'declare', value: 9 });
    await game.handleAction('p2', { type: 'declare', value: 4 });

    expect(game.state).toBe('SETTLED');
    expect(fc.calls.settle).toHaveLength(1);
    expect(fc.calls.settle[0]!.winnerAccountId).toBe('acc-p1'); // higher value wins
    expect(settled).toHaveBeenCalledWith({ winner: 'p1' });
  });

  it("hides opponents' hidden info until showdown (client read-only projection)", async () => {
    const fc = mockFc();
    const game = new HighCard('t1', fc, new EventBus<HighCardEvents>(), acct);
    await game.start(['p1', 'p2']);
    await game.handleAction('p1', { type: 'declare', value: 9 });

    // p2 cannot see p1's declaration mid-hand.
    const midView = game.getPublicState('p2') as { opponents: { value: number | null }[] };
    expect(midView.opponents[0]!.value).toBeNull();

    await game.handleAction('p2', { type: 'declare', value: 4 });
    // After settlement it's revealed.
    const endView = game.getPublicState('p2') as { opponents: { value: number | null }[] };
    expect(endView.opponents[0]!.value).toBe(9);
  });

  it('cannot skip states — the StateMachine blocks illegal phase jumps', async () => {
    const fc = mockFc();
    const game = new HighCard('t1', fc, new EventBus<HighCardEvents>(), acct);
    // Settling before anyone plays would require IN_PROGRESS→... ; starting twice is illegal.
    await game.start(['p1', 'p2']);
    await expect(game.start(['p1', 'p2'])).rejects.toThrow(InvalidTransitionError);
  });
});
