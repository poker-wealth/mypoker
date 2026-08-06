import { GAME_IDS, type GameId, type FairnessTier } from './game-catalog';
import type { TableFilter } from './lobby-service';

/**
 * Parsing of lobby filter query strings.
 *
 * Shared by the Express gateway and the serverless lobby function so the two
 * cannot validate differently — an endpoint that accepts a filter in one
 * deployment and rejects it in the other is the kind of difference that only
 * surfaces in production.
 *
 * Hand-rolled rather than zod, deliberately. This module is reachable from a
 * Netlify function, and Netlify leaves bare imports external: a third-party
 * dependency here means the function dies at runtime with a module-not-found,
 * which is exactly what happened. The validation is an enum check, two number
 * checks and two booleans — not worth a package, and certainly not worth a
 * second copy of the rules to avoid one.
 *
 * Booleans are compared to the string 'true' rather than coerced: query params
 * arrive as strings and Boolean('false') is true, so a naive read of
 * hasSeats=false means the opposite of what the caller asked for.
 */

export class FilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterError';
  }
}

const FAIRNESS: FairnessTier[] = ['PROVABLE', 'VENDOR_ATTESTED'];

function optionalNumber(raw: unknown, field: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new FilterError(`${field} must be a non-negative number`);
  }
  return value;
}

function optionalBoolean(raw: unknown, field: string): boolean | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw !== 'true' && raw !== 'false') {
    throw new FilterError(`${field} must be 'true' or 'false'`);
  }
  return raw === 'true';
}

/** Throws FilterError on an invalid filter — callers map that to a 400. */
export function parseTableFilter(input: Record<string, unknown>): TableFilter {
  const filter: TableFilter = {};

  if (input.gameId !== undefined && input.gameId !== '') {
    if (!GAME_IDS.includes(input.gameId as GameId)) {
      throw new FilterError(`unknown gameId: ${String(input.gameId)}`);
    }
    filter.gameId = input.gameId as GameId;
  }

  const minStakes = optionalNumber(input.minStakes, 'minStakes');
  if (minStakes !== undefined) filter.minStakes = minStakes;

  const maxStakes = optionalNumber(input.maxStakes, 'maxStakes');
  if (maxStakes !== undefined) filter.maxStakes = maxStakes;

  const minJackpot = optionalNumber(input.minJackpot, 'minJackpot');
  if (minJackpot !== undefined) filter.minJackpot = minJackpot;

  const hasSeats = optionalBoolean(input.hasSeats, 'hasSeats');
  if (hasSeats !== undefined) filter.hasSeats = hasSeats;

  const readyOnly = optionalBoolean(input.readyOnly, 'readyOnly');
  if (readyOnly !== undefined) filter.readyOnly = readyOnly;

  if (input.fairness !== undefined && input.fairness !== '') {
    if (!FAIRNESS.includes(input.fairness as FairnessTier)) {
      throw new FilterError(`unknown fairness tier: ${String(input.fairness)}`);
    }
    filter.fairness = input.fairness as FairnessTier;
  }

  return filter;
}
