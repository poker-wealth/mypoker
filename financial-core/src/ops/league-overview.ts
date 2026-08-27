import { Money } from '../domain/money';
import { AccountType, LedgerType, LedgerDirection } from '../domain/account-types';
import { AccountModel } from '../wallet/account.model';
import { LedgerModel } from '../wallet/ledger.model';
import { LeagueModel, MembershipModel, getLeague, membersOf } from '../league/league-store';

/**
 * Every league, with the figures an operator needs (SAMUEL.md task 3, screen 4;
 * 12-week plan W10 "league overview — volume, rake, player list, Jackpot
 * balances").
 *
 * Read-only. The top-up and cash-out actions the screen will eventually carry
 * move money between TREASURY and LEAGUE_INVENTORY — the clearing rules already
 * permit both directions and the ledger types already exist, but nothing
 * performs either yet. That is a money path, and it is built and reviewed
 * separately from this.
 *
 * Per-league, never pooled. §3.1 makes the platform and each league separate
 * fund systems with no cross-subsidy, so a combined figure would describe a
 * pool that does not exist and hide the one that does.
 */
export interface LeagueOverviewRow {
  leagueId: string;
  name: string;
  ownerId: string;
  memberCount: number;
  inviteOnly: boolean;
  /** LEAGUE_INVENTORY balance — what the league has to pay its own winners. */
  inventory: string;
  /** Rake this league has taken, all time. */
  rake: string;
  /** Insurance reserve for this league's own system, if it has one. */
  insurance: string;
  createdAt: string;
}

export async function getLeagueOverview(): Promise<LeagueOverviewRow[]> {
  const leagues = await LeagueModel.find({}).sort({ createdAt: -1 }).lean();
  if (leagues.length === 0) return [];

  const ids = leagues.map((l) => l._id);

  const [members, accounts, rakeRows] = await Promise.all([
    MembershipModel.aggregate<{ _id: string; n: number }>([
      { $match: { leagueId: { $in: ids } } },
      { $group: { _id: '$leagueId', n: { $sum: 1 } } },
    ]),
    // Inventory and insurance are both owned by the leagueId, so one query
    // covers them and the type tells them apart.
    AccountModel.find(
      {
        ownerId: { $in: ids },
        accountType: { $in: [AccountType.LEAGUE_INVENTORY, AccountType.INSURANCE] },
      },
      { ownerId: 1, accountType: 1, availableBalance: 1 },
    ).lean(),
    // Rake credited to a league's own account. The CREDIT side only — the debit
    // is the pot paying it, and counting both would double every figure.
    LedgerModel.find({ type: LedgerType.RAKE, direction: LedgerDirection.CREDIT }).lean(),
  ]);

  const memberCounts = new Map(members.map((m) => [m._id, m.n]));

  const inventory = new Map<string, Money>();
  const insurance = new Map<string, Money>();
  for (const a of accounts) {
    const target = a.accountType === AccountType.LEAGUE_INVENTORY ? inventory : insurance;
    const current = target.get(a.ownerId) ?? Money.ZERO;
    target.set(a.ownerId, current.add(Money.fromDecimal128(a.availableBalance)));
  }

  // Rake rows carry the account they landed in; match them back to a league by
  // that account's owner.
  const accountOwner = new Map(accounts.map((a) => [a._id, a.ownerId]));
  const rake = new Map<string, Money>();
  for (const row of rakeRows) {
    const owner = accountOwner.get(row.accountId);
    if (!owner) continue; // platform rake, not a league's
    rake.set(owner, (rake.get(owner) ?? Money.ZERO).add(Money.fromDecimal128(row.amount)));
  }

  return leagues.map((l) => ({
    leagueId: l._id,
    name: l.name,
    ownerId: l.ownerId,
    memberCount: memberCounts.get(l._id) ?? 0,
    inviteOnly: l.inviteOnly,
    inventory: (inventory.get(l._id) ?? Money.ZERO).toString(),
    rake: (rake.get(l._id) ?? Money.ZERO).toString(),
    insurance: (insurance.get(l._id) ?? Money.ZERO).toString(),
    createdAt: l.createdAt.toISOString(),
  }));
}

export interface LeagueMemberRow {
  playerId: string;
  role: string;
  joinedAt: string;
}

export interface LeagueDetail extends LeagueOverviewRow {
  description: string | null;
  settings: { rakeBps: number; tableHours: number; buyIn: number; spectatorsAllowed: boolean } | null;
  pendingRakeChange: { rakeBps: number; effectiveAt: string } | null;
  members: LeagueMemberRow[];
}

/**
 * One league, with its roster and money — for the admin's drill-into-a-club view.
 *
 * The roster carries role and join date but NO per-member balance: what a member
 * holds is theirs, and the league-store deliberately does not select it (wallet
 * isolation is structural). Inventory/insurance/rake are THIS league's own, per
 * §3.1 — never the platform's, never another club's.
 */
export async function getLeagueDetail(leagueId: string): Promise<LeagueDetail | null> {
  const league = await getLeague(leagueId);
  if (!league) return null;

  const [members, accounts] = await Promise.all([
    membersOf(leagueId),
    AccountModel.find(
      {
        ownerId: leagueId,
        accountType: { $in: [AccountType.LEAGUE_INVENTORY, AccountType.INSURANCE] },
      },
      { _id: 1, accountType: 1, availableBalance: 1 },
    ).lean(),
  ]);

  let inventory = Money.ZERO;
  let insurance = Money.ZERO;
  const accountIds: string[] = [];
  for (const a of accounts) {
    accountIds.push(a._id);
    const bal = Money.fromDecimal128(a.availableBalance);
    if (a.accountType === AccountType.LEAGUE_INVENTORY) inventory = inventory.add(bal);
    else insurance = insurance.add(bal);
  }

  const rakeRows = accountIds.length
    ? await LedgerModel.find({
        type: LedgerType.RAKE,
        direction: LedgerDirection.CREDIT,
        accountId: { $in: accountIds },
      }).lean()
    : [];
  const rake = Money.sum(rakeRows.map((r) => Money.fromDecimal128(r.amount)));

  return {
    leagueId: league.leagueId,
    name: league.name,
    ownerId: league.ownerId,
    memberCount: league.memberCount,
    inviteOnly: league.inviteOnly,
    inventory: inventory.toString(),
    rake: rake.toString(),
    insurance: insurance.toString(),
    createdAt: league.createdAt,
    description: league.description,
    settings: league.settings,
    pendingRakeChange: league.pendingRakeChange,
    members,
  };
}
