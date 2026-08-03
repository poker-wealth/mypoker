/**
 * What an agent is allowed to do (FairPlay v5.9 §13) — and, far more importantly, what they can't.
 *
 * THE IRON RULE: an agent has referral tracking and READ-ONLY data. Zero access to player balances.
 * They cannot top up or cash out for ANY player, including their own downline.
 *
 * This is the wall against the oldest scam in this business: the agent who becomes an informal
 * banker, takes players' deposits "to top them up", and disappears. If an agent can never touch a
 * balance, that fraud is not policy-forbidden — it is impossible. Players always deposit and
 * withdraw through the Financial Core, directly, themselves.
 *
 * Agents are promoters. They are not bankers, and this module is where that is enforced.
 */

export type AgentCapability =
  | 'VIEW_REFERRAL_STATS' // how many players, their volume
  | 'VIEW_COMMISSION' // their own earnings
  | 'SET_SUB_AGENT_RATE' // top-level agents only
  | 'VIEW_DOWNLINE_LIST';

/** The complete, closed set. Anything not on this list is denied by default. */
const ALLOWED: readonly AgentCapability[] = [
  'VIEW_REFERRAL_STATS',
  'VIEW_COMMISSION',
  'SET_SUB_AGENT_RATE',
  'VIEW_DOWNLINE_LIST',
];

/**
 * Money actions an agent may NEVER perform, named explicitly so the ban is greppable and testable
 * rather than implied by absence.
 */
export const FORBIDDEN_MONEY_ACTIONS = [
  'VIEW_PLAYER_BALANCE',
  'TOP_UP_PLAYER',
  'CASH_OUT_PLAYER',
  'TRANSFER_PLAYER_FUNDS',
  'ADJUST_PLAYER_BALANCE',
] as const;
export type ForbiddenMoneyAction = (typeof FORBIDDEN_MONEY_ACTIONS)[number];

export function agentCan(capability: string, isTopLevel: boolean): boolean {
  if ((FORBIDDEN_MONEY_ACTIONS as readonly string[]).includes(capability)) return false;
  if (capability === 'SET_SUB_AGENT_RATE') return isTopLevel; // a sub-agent owns no rates
  return (ALLOWED as readonly string[]).includes(capability);
}

/** Never true. Present so the guarantee is asserted in tests, not just documented. */
export function agentCanTouchPlayerFunds(_agentId: string, _playerId: string): false {
  return false;
}

/**
 * Wallet isolation (§13): commission is credited to the agent's PLATFORM wallet. A league wallet is
 * visible only inside its league context — never on the My page and never in the agent dashboard.
 */
export type WalletScope = 'PLATFORM' | 'LEAGUE';

export function commissionCreditScope(): WalletScope {
  return 'PLATFORM';
}

export function walletVisibleInAgentDashboard(scope: WalletScope): boolean {
  return scope === 'PLATFORM';
}
