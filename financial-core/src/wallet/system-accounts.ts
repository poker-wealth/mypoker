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
