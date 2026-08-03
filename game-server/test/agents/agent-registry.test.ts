import { AgentRegistry, reviewApplication } from '../../src/agents/agent-registry';
import { CommissionRuleError } from '../../src/agents/commission';
import {
  agentCan,
  agentCanTouchPlayerFunds,
  FORBIDDEN_MONEY_ACTIONS,
  commissionCreditScope,
  walletVisibleInAgentDashboard,
} from '../../src/agents/agent-permissions';

function registry(): AgentRegistry {
  const r = new AgentRegistry();
  r.addAgent('A', 'code-A');
  r.addSubAgent('A', 'B', 2000, 'code-B');
  return r;
}

describe('IRON RULE — an agent can never touch player money', () => {
  it('every money action is denied', () => {
    for (const action of FORBIDDEN_MONEY_ACTIONS) {
      expect(agentCan(action, true)).toBe(false); // even a top-level agent
      expect(agentCan(action, false)).toBe(false);
    }
  });

  it('cannot top up or cash out for their own downline', () => {
    expect(agentCan('TOP_UP_PLAYER', true)).toBe(false);
    expect(agentCan('CASH_OUT_PLAYER', true)).toBe(false);
    expect(agentCanTouchPlayerFunds('A', 'their-own-player')).toBe(false);
  });

  it('cannot even VIEW a player’s balance', () => {
    expect(agentCan('VIEW_PLAYER_BALANCE', true)).toBe(false);
  });

  it('what they CAN do is referral tracking and read-only data', () => {
    expect(agentCan('VIEW_REFERRAL_STATS', true)).toBe(true);
    expect(agentCan('VIEW_COMMISSION', true)).toBe(true);
    expect(agentCan('VIEW_DOWNLINE_LIST', true)).toBe(true);
  });

  it('anything not on the allow-list is denied by default', () => {
    expect(agentCan('SOMETHING_INVENTED_LATER', true)).toBe(false);
  });
});

describe('wallet isolation', () => {
  it('commission credits the agent’s PLATFORM wallet', () => {
    expect(commissionCreditScope()).toBe('PLATFORM');
  });

  it('a league wallet never appears in the agent dashboard', () => {
    expect(walletVisibleInAgentDashboard('LEAGUE')).toBe(false);
    expect(walletVisibleInAgentDashboard('PLATFORM')).toBe(true);
  });
});

describe('two levels maximum — this is not a pyramid', () => {
  it('a sub-agent CANNOT recruit sub-agents', () => {
    const r = registry();
    expect(() => r.addSubAgent('B', 'C', 1000, 'code-C')).toThrow(/2 levels maximum/);
  });

  it('only the parent may set a sub-agent’s rate', () => {
    const r = registry();
    r.addAgent('OTHER', 'code-O');
    expect(() => r.setSubAgentRate('OTHER', 'B', 1000)).toThrow(/only the parent/);
    expect(() => r.setSubAgentRate('A', 'B', 1000)).not.toThrow();
    expect(r.get('B')!.rateBps).toBe(1000);
  });

  it('the parent can change the rate at any time, within bounds', () => {
    const r = registry();
    expect(() => r.setSubAgentRate('A', 'B', 2600)).toThrow(CommissionRuleError);
    expect(r.get('B')!.rateBps).toBe(2000); // unchanged after a rejected set
  });
});

describe('referral chain', () => {
  it('a player under B earns for both B and A', () => {
    const r = registry();
    r.linkPlayer('p1', 'B');
    const chain = r.chainFor('p1');
    expect(chain.subAgent?.agentId).toBe('B');
    expect(chain.agent?.agentId).toBe('A');
  });

  it('a player directly under A earns for A only', () => {
    const r = registry();
    r.linkPlayer('p2', 'A');
    const chain = r.chainFor('p2');
    expect(chain.agent?.agentId).toBe('A');
    expect(chain.subAgent).toBeUndefined();
  });

  it('an unreferred player earns nobody anything', () => {
    expect(registry().chainFor('nobody')).toEqual({});
  });
});

describe('eligibility (v5.9 §13.3) — reuses the standing systems', () => {
  const ok = {
    playerId: 'p',
    reputationScore: 700,
    hasConfirmedCollusion: false,
    antiBotHighRisk: false,
  };

  it('approves reputation ≥ 700 with a clean record', () => {
    expect(reviewApplication(ok)).toEqual({ approved: true });
  });

  it('rejects low reputation, collusion, or a bot flag — with the reason stated', () => {
    expect(reviewApplication({ ...ok, reputationScore: 699 })).toMatchObject({
      approved: false,
      reasons: [expect.stringMatching(/below 700/)],
    });
    expect(reviewApplication({ ...ok, hasConfirmedCollusion: true })).toMatchObject({
      approved: false,
      reasons: ['confirmed collusion record'],
    });
    expect(reviewApplication({ ...ok, antiBotHighRisk: true })).toMatchObject({
      approved: false,
      reasons: ['anti-bot high-risk flag'],
    });
  });

  it('lists every failure, not just the first', () => {
    const out = reviewApplication({
      playerId: 'p',
      reputationScore: 100,
      hasConfirmedCollusion: true,
      antiBotHighRisk: true,
    });
    expect(out.approved).toBe(false);
    expect((out as { reasons: string[] }).reasons).toHaveLength(3);
  });
});
