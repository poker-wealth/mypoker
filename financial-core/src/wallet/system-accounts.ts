import { AccountType, WORLD_OWNER, PLATFORM_SCOPE } from '../domain/account-types';
import { AccountModel, type AccountDoc } from './account.model';

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Get (or lazily create) a player's wallet account for a given scope. Defaults to the platform
 * wallet; pass `league:<id>` for a league wallet.
 */
export async function getOrCreatePlayerAccount(
  playerId: string,
  scope: string = PLATFORM_SCOPE,
): Promise<AccountDoc> {
  const existing = await AccountModel.findOne({
    accountType: AccountType.PLAYER,
    ownerId: playerId,
    scope,
  });
  if (existing) return existing;
  try {
    return await AccountModel.create({ accountType: AccountType.PLAYER, ownerId: playerId, scope });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const created = await AccountModel.findOne({
        accountType: AccountType.PLAYER,
        ownerId: playerId,
        scope,
      });
      if (created) return created;
    }
    throw err;
  }
}

/** Get (or lazily create) the singleton EXTERNAL boundary account. */
export async function getOrCreateExternalAccount(): Promise<AccountDoc> {
  const existing = await AccountModel.findOne({
    accountType: AccountType.EXTERNAL,
    ownerId: WORLD_OWNER,
  });
  if (existing) return existing;
  try {
    return await AccountModel.create({ accountType: AccountType.EXTERNAL, ownerId: WORLD_OWNER });
  } catch (err) {
    // Lost a create race — the unique (type, owner, scope) index rejected the duplicate.
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      const created = await AccountModel.findOne({
        accountType: AccountType.EXTERNAL,
        ownerId: WORLD_OWNER,
      });
      if (created) return created;
    }
    throw err;
  }
}

/**
 * The four per-table jackpot pool accounts, created on demand.
 *
 * Per spec, jackpot pools are keyed by TABLE — "JACKPOT account owner_id =
 * tableId (not gameType)" — so cross-game isolation holds by construction.
 *
 * Existence matters more than it looks: transfer() throws AccountNotFoundError
 * for a missing account, so a settlement crediting a pool nobody created fails.
 * The live room had been passing ids that were never created; every settlement
 * path that touches jackpot accounts now ensures them first.
 */
const JACKPOT_TYPE: Record<string, AccountType> = {
  mini: AccountType.JACKPOT_MINI,
  minor: AccountType.JACKPOT_MINOR,
  major: AccountType.JACKPOT_MAJOR,
  grand: AccountType.JACKPOT_GRAND,
};

export async function ensureJackpotAccounts(
  tableId: string,
  ids: { mini: string; minor: string; major: string; grand: string },
): Promise<void> {
  // Match on (accountType, ownerId, scope) — the unique index — not on the caller's `_id`. Two
  // callers have disagreed about a pool's id shape (the game server's room classes name pools
  // `jp:<tier>:<table>` in one place and `jp:<table>:<tier>` in another; the jackpot-payout route
  // also guesses a shape for tiers it isn't paying this round). Matching by `_id` meant a second
  // caller using the OTHER shape for the same real account tried to INSERT a second document under
  // the same (type, owner, scope) — which the unique index rejects with E11000, taking the whole
  // request (and every tier in the same Promise.all) down with it. A table's four pools are keyed by
  // (accountType, ownerId, scope) here for exactly the same reason ensureRakeAccount below is.
  await Promise.all(
    (Object.keys(JACKPOT_TYPE) as (keyof typeof ids)[]).map(async (tier) => {
      try {
        await AccountModel.updateOne(
          { accountType: JACKPOT_TYPE[tier], ownerId: tableId, scope: PLATFORM_SCOPE },
          {
            $setOnInsert: {
              _id: ids[tier],
              accountType: JACKPOT_TYPE[tier],
              ownerId: tableId,
              scope: PLATFORM_SCOPE,
            },
          },
          { upsert: true },
        );
      } catch (err) {
        // Two first-settlements for the same brand-new table can race: both miss the match, both
        // try to insert, the unique index accepts one and rejects the other with a duplicate-key
        // error. The account exists either way, which is all this function promises — so a
        // duplicate key here is success, not failure (same treatment as getOrCreatePlayerAccount /
        // getOrCreateExternalAccount above).
        if (!isDuplicateKeyError(err)) throw err;
      }
    }),
  );
}

/**
 * The rake destination account (TREASURY for a platform table, LEAGUE_INVENTORY for a league),
 * created on demand. Settlement credits the rake here and throws if it is missing — so, exactly like
 * the jackpot pools, the settlement path ensures it first. Without this, the FIRST real hand with
 * rake on a fresh database fails ("Account not found: TREASURY/PLATFORM"). Keyed by a deterministic
 * system id so two concurrent first-hands cannot create duplicates.
 */
export async function ensureRakeAccount(accountType: AccountType, ownerId: string): Promise<void> {
  // Match on (accountType, ownerId) — the same shape settlement looks it up by — so if one already
  // exists (any _id) we do NOT create a duplicate; only a fresh system gets a new one.
  await AccountModel.updateOne(
    { accountType, ownerId },
    { $setOnInsert: { accountType, ownerId } },
    { upsert: true },
  );
}

/** Ensure and return the account id for a rake destination (TREASURY / LEAGUE_INVENTORY). */
export async function getRakeAccountId(accountType: AccountType, ownerId: string): Promise<string> {
  await ensureRakeAccount(accountType, ownerId);
  const acc = await AccountModel.findOne({ accountType, ownerId }).lean();
  if (!acc) throw new Error(`rake account missing after ensure: ${accountType}/${ownerId}`);
  return acc._id;
}

/**
 * The insurance and reinsurance pool for one system, created on demand.
 *
 * Per spec §3.1 the pools are owned by `PLATFORM` or a `leagueId` — the two
 * insurance systems are completely separate, with independent reinsurance and
 * no cross-subsidy. One pair of accounts per owner enforces that by
 * construction: a league's quotes are underwritten by the league's own pool
 * because that is the only pool its owner id reaches.
 */
export const insuranceAccountId = (ownerId: string): string => `ins:${ownerId}`;
export const reinsuranceAccountId = (ownerId: string): string => `reins:${ownerId}`;

export async function ensureInsuranceAccounts(ownerId: string): Promise<void> {
  await Promise.all([
    AccountModel.updateOne(
      { _id: insuranceAccountId(ownerId) },
      {
        $setOnInsert: {
          _id: insuranceAccountId(ownerId),
          accountType: AccountType.INSURANCE,
          ownerId,
        },
      },
      { upsert: true },
    ),
    AccountModel.updateOne(
      { _id: reinsuranceAccountId(ownerId) },
      {
        $setOnInsert: {
          _id: reinsuranceAccountId(ownerId),
          accountType: AccountType.REINSURANCE,
          ownerId,
        },
      },
      { upsert: true },
    ),
  ]);
}
