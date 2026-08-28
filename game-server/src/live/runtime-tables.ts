import type { LiveTableIdentity } from '../lobby/live-sync';

/**
 * Registry of PUBLIC player-created tables.
 *
 * A player can create a table and choose whether it's public or private (owner's
 * call). PRIVATE tables live only in the hub — reachable by their link, never
 * listed — so they need nothing here. PUBLIC ones must appear in the lobby, but
 * the lobby resync (live-sync.ts) only keeps tables it can find in an identity
 * list, and removes everything else. So a public runtime table is registered
 * here, and the resync is handed `defaultTables() + runtimePublicTables()`,
 * which lists and preserves it. Unregister on close, or the resync keeps trying
 * to describe a room that is gone.
 */
const registry = new Map<string, LiveTableIdentity>();

export function registerPublicTable(id: string, game: LiveTableIdentity['game']): void {
  registry.set(id, { id, game });
}

export function unregisterTable(id: string): void {
  registry.delete(id);
}

export function runtimePublicTables(): LiveTableIdentity[] {
  return [...registry.values()];
}
