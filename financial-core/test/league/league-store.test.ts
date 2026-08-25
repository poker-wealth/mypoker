import {
  createLeague,
  getLeague,
  joinLeague,
  leaveLeague,
  membershipOf,
  membersOf,
  leaguesFor,
  discoverLeagues,
  assertContextAccess,
  accountScopeFor,
  leagueContext,
  PLATFORM,
  LeagueError,
  LeagueModel,
  MembershipModel,
} from '../../src/league/league-store';
import { startTestDb, stopTestDb, clearCollections } from '../db-helper';

/**
 * The isolation block at the bottom is the reason this file exists. Platform and
 * League staying separate is an iron rule, and the failure it guards against is
 * not a wrong pixel — it is a player buying into a table with money that lives
 * on the other side of the boundary.
 */

const OWNER = 'tg-owner';
const MEMBER = 'tg-member';
const OUTSIDER = 'tg-outsider';

beforeAll(startTestDb);
afterAll(stopTestDb);
afterEach(clearCollections);

const makeLeague = (over: Partial<Parameters<typeof createLeague>[0]> = {}) =>
  createLeague({ leagueId: 'lg-1', name: 'Dragon Alliance', ownerId: OWNER, ...over });

describe('creating a league', () => {
  it('creates it with the owner already a member', async () => {
    const league = await makeLeague();

    expect(league.name).toBe('Dragon Alliance');
    expect(league.memberCount).toBe(1);
    // An owner who is not a member would fail every membership check while
    // being the one person who must never fail them.
    expect(await membershipOf('lg-1', OWNER)).toBe('OWNER');
  });

  it('rejects a name that is too short or too long', async () => {
    await expect(makeLeague({ name: 'x' })).rejects.toThrow(LeagueError);
    await expect(makeLeague({ name: 'x'.repeat(41) })).rejects.toThrow(LeagueError);
  });

  it('trims whitespace rather than storing it', async () => {
    const league = await makeLeague({ name: '  Phoenix Club  ' });
    expect(league.name).toBe('Phoenix Club');
  });

  it('refuses to create the same league twice', async () => {
    await makeLeague();
    await expect(makeLeague()).rejects.toThrow(/already exists/);
  });
});

describe('membership', () => {
  beforeEach(async () => {
    await makeLeague();
  });

  it('lets a player join and records them as a member', async () => {
    await joinLeague('lg-1', MEMBER);

    expect(await membershipOf('lg-1', MEMBER)).toBe('MEMBER');
    expect((await getLeague('lg-1'))!.memberCount).toBe(2);
  });

  it('is idempotent — a double tap creates one membership', async () => {
    await joinLeague('lg-1', MEMBER);
    await joinLeague('lg-1', MEMBER);

    expect(await MembershipModel.countDocuments({ leagueId: 'lg-1' })).toBe(2); // owner + member
  });

  it('refuses to join a league that does not exist', async () => {
    await expect(joinLeague('lg-nope', MEMBER)).rejects.toThrow(/no such league/);
  });

  it('refuses to join an invite-only league', async () => {
    await createLeague({ leagueId: 'lg-2', name: 'Elite', ownerId: OWNER, inviteOnly: true });
    await expect(joinLeague('lg-2', MEMBER)).rejects.toThrow(/invite-only/);
  });

  it('lets a member leave', async () => {
    await joinLeague('lg-1', MEMBER);
    await leaveLeague('lg-1', MEMBER);
    expect(await membershipOf('lg-1', MEMBER)).toBeNull();
  });

  it('will not let the owner leave and strand the league', async () => {
    // No admin, and no way to appoint one. Ownership transfer is its own
    // operation, not a side effect of leaving.
    await expect(leaveLeague('lg-1', OWNER)).rejects.toThrow(/owner cannot leave/);
  });

  it('lists every league a player belongs to', async () => {
    await createLeague({ leagueId: 'lg-2', name: 'King Poker', ownerId: OWNER });
    await joinLeague('lg-1', MEMBER);

    expect((await leaguesFor(MEMBER)).map((l) => l.leagueId)).toEqual(['lg-1']);
    expect((await leaguesFor(OWNER)).map((l) => l.leagueId).sort()).toEqual(['lg-1', 'lg-2']);
    expect(await leaguesFor(OUTSIDER)).toEqual([]);
  });
});

describe('discovery', () => {
  it('excludes invite-only leagues', async () => {
    await makeLeague();
    await createLeague({ leagueId: 'lg-secret', name: 'Hidden', ownerId: OWNER, inviteOnly: true });

    const found = await discoverLeagues();
    expect(found.map((l) => l.leagueId)).toEqual(['lg-1']);
  });
});

describe('IRON RULE: platform and league stay isolated', () => {
  beforeEach(async () => {
    await makeLeague();
    await joinLeague('lg-1', MEMBER);
  });

  it('lets any player operate in the platform context', async () => {
    // Platform is every player's home context — including someone in no league.
    await expect(assertContextAccess(PLATFORM, OUTSIDER)).resolves.toBeUndefined();
  });

  it('lets a member operate in their own league context', async () => {
    await expect(assertContextAccess(leagueContext('lg-1'), MEMBER)).resolves.toBeUndefined();
  });

  it('refuses a non-member the league context', async () => {
    // The whole rule in one assertion: an outsider cannot read into a league.
    await expect(assertContextAccess(leagueContext('lg-1'), OUTSIDER)).rejects.toThrow(
      /not a member/,
    );
  });

  it('refuses a league a player has left', async () => {
    await leaveLeague('lg-1', MEMBER);
    await expect(assertContextAccess(leagueContext('lg-1'), MEMBER)).rejects.toThrow(/not a member/);
  });

  it('refuses one league to a member of another', async () => {
    await createLeague({ leagueId: 'lg-2', name: 'Rivals', ownerId: OUTSIDER });
    await expect(assertContextAccess(leagueContext('lg-2'), MEMBER)).rejects.toThrow(/not a member/);
  });

  it('maps each context to exactly one account scope', () => {
    // Total by construction — no "either", no default. A wrong answer here is
    // money crossing the boundary, not a display bug.
    expect(accountScopeFor(PLATFORM)).toBe('PLATFORM');
    expect(accountScopeFor(leagueContext('lg-1'))).toBe('LEAGUE_INVENTORY');
    expect(accountScopeFor(leagueContext('lg-2'))).toBe('LEAGUE_INVENTORY');
  });

  it('never resolves a league context to the platform scope', async () => {
    // Belt and braces: whatever the league, the scope must not fall back.
    const leagues = await LeagueModel.find().lean();
    for (const l of leagues) {
      expect(accountScopeFor(leagueContext(l._id))).not.toBe('PLATFORM');
    }
  });
});

describe('membersOf — the roster', () => {
  it('lists everyone, oldest first, with their role', async () => {
    await makeLeague();
    await joinLeague('lg-1', MEMBER);
    await joinLeague('lg-1', OUTSIDER);

    const members = await membersOf('lg-1');

    expect(members.map((m) => m.playerId)).toEqual([OWNER, MEMBER, OUTSIDER]);
    expect(members[0]!.role).toBe('OWNER');
    expect(members[1]!.role).toBe('MEMBER');
    // A date the UI can render without inventing one.
    expect(Number.isNaN(Date.parse(members[0]!.joinedAt))).toBe(false);
  });

  it('carries no balance field — an owner funding a league cannot see holdings', async () => {
    await makeLeague();
    await joinLeague('lg-1', MEMBER);

    const [first] = await membersOf('lg-1');

    // Structural, not filtered: the shape simply has no such field. If someone
    // later selects one into it, this fails rather than quietly leaking.
    expect(Object.keys(first!).sort()).toEqual(['joinedAt', 'playerId', 'role']);
  });

  it('is scoped to one league', async () => {
    await makeLeague();
    await makeLeague({ leagueId: 'lg-2', name: 'Other', ownerId: OUTSIDER });
    await joinLeague('lg-1', MEMBER);

    expect((await membersOf('lg-2')).map((m) => m.playerId)).toEqual([OUTSIDER]);
  });

  it('is empty for a league that does not exist', async () => {
    expect(await membersOf('lg-nope')).toEqual([]);
  });

  it('drops someone who left', async () => {
    await makeLeague();
    await joinLeague('lg-1', MEMBER);
    await leaveLeague('lg-1', MEMBER);

    expect((await membersOf('lg-1')).map((m) => m.playerId)).toEqual([OWNER]);
  });
});
