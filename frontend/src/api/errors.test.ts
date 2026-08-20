import { describe, it, expect } from 'vitest';
import { ApiError } from './client';
import { leagueTableErrorKey } from './errors';

/**
 * Every documented answer of POST /leagues/:leagueId/tables has to reach the
 * player as a different sentence. The two that matter most are the ones a
 * generic handler gets wrong: a 403 is NOT an expired session (the player is
 * signed in and simply is not an admin), and the "no settings yet" 400 is an
 * instruction, not a validation complaint.
 */
describe('leagueTableErrorKey', () => {
  const at = (status: number, message = 'x'): ApiError => new ApiError(status, message);

  it('separates "not an admin" from "not a member"', () => {
    expect(leagueTableErrorKey(at(403, 'only a league owner or admin can open a table'))).toBe(
      'alliance.tableNotAdmin',
    );
    expect(leagueTableErrorKey(at(404, 'no such league: dragons'))).toBe('alliance.tableNotMember');
  });

  it('never collapses a 403 into "your session expired"', () => {
    expect(leagueTableErrorKey(at(403))).not.toBe('states.sessionExpired');
    expect(leagueTableErrorKey(at(401))).toBe('states.sessionExpired');
  });

  it('splits the two 400s on the server message', () => {
    expect(
      leagueTableErrorKey(at(400, 'set the league rake and buy-in before opening a table')),
    ).toBe('alliance.tableNoSettings');
    expect(leagueTableErrorKey(at(400, 'invalid table settings'))).toBe('alliance.tableInvalid');
    // An unrecognised 400 must still land somewhere sensible, not on the
    // actionable "go set your rake" message.
    expect(leagueTableErrorKey(at(400, 'a table seats between 2 and 9'))).toBe(
      'alliance.tableInvalid',
    );
  });

  it('reports an unreachable or unavailable service as such', () => {
    expect(leagueTableErrorKey(at(0, 'network'))).toBe('states.offline');
    expect(leagueTableErrorKey(at(502, 'league service unavailable'))).toBe(
      'states.serviceUnavailable',
    );
    expect(leagueTableErrorKey(at(503, 'league tables are temporarily closed'))).toBe(
      'alliance.tableClosed',
    );
  });

  it('falls back for anything that is not an ApiError', () => {
    expect(leagueTableErrorKey(new Error('boom'))).toBe('states.error');
    expect(leagueTableErrorKey(undefined)).toBe('states.error');
  });
});
