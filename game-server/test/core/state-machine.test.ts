import { StateMachine, InvalidTransitionError } from '../../src/core/state-machine';

type Phase = 'WAITING' | 'DEALING' | 'BETTING' | 'SHOWDOWN' | 'SETTLED';

function makeSm(): StateMachine<Phase> {
  return new StateMachine<Phase>({
    initial: 'WAITING',
    transitions: {
      WAITING: ['DEALING'],
      DEALING: ['BETTING'],
      BETTING: ['BETTING', 'SHOWDOWN'],
      SHOWDOWN: ['SETTLED'],
      SETTLED: [],
    },
  });
}

describe('StateMachine', () => {
  it('starts in the initial state', () => {
    expect(makeSm().state).toBe('WAITING');
  });

  it('allows whitelisted transitions and reports can()', () => {
    const sm = makeSm();
    expect(sm.can('DEALING')).toBe(true);
    sm.transition('DEALING');
    expect(sm.state).toBe('DEALING');
    sm.transition('BETTING');
    expect(sm.is('BETTING')).toBe(true);
    // BETTING -> BETTING is allowed (another betting round).
    sm.transition('BETTING');
    expect(sm.state).toBe('BETTING');
  });

  it('throws on an illegal transition', () => {
    const sm = makeSm();
    expect(() => sm.transition('SHOWDOWN')).toThrow(InvalidTransitionError);
    expect(sm.state).toBe('WAITING'); // unchanged
  });

  it('fires onExit then onEnter with the correct from/to', () => {
    const order: string[] = [];
    const sm = new StateMachine<Phase>({
      initial: 'WAITING',
      transitions: { WAITING: ['DEALING'], DEALING: [], BETTING: [], SHOWDOWN: [], SETTLED: [] },
      onExit: { WAITING: (to) => order.push(`exit WAITING->${to}`) },
      onEnter: { DEALING: (from) => order.push(`enter DEALING<-${from}`) },
    });
    sm.transition('DEALING');
    expect(order).toEqual(['exit WAITING->DEALING', 'enter DEALING<-WAITING']);
  });
});
