import type { PlayerDirectory, TablePlayer } from './players';
import { usdtToChips } from './chip-currency';

interface Cached {
  available: number;
  displayName: string;
  avatarUrl?: string;
  reputationScore: number;
}

export interface FcDirectoryOptions {
  /** The Financial Core API base, e.g. http://financial-core:4001/api/v1 */
  baseUrl: string;
  internalSecret: string;
  fetchImpl?: typeof fetch;
}

/**
 * `PlayerDirectory` backed by the Financial Core.
 *
 * The room only READS from the directory — a player's available balance for the buy-in pre-check,
 * and the seat's display hint. Every actual money move goes through the `FinancialCoreClient`, whose
 * ledger runs the authoritative overdraft guard. So this serves a cached balance, warmed when the
 * player joins the table (`prime`), before they can sit — a stale read only costs an extra "buy in
 * again", never a wrong balance on the felt.
 *
 * Display name/avatar are the client's hint (the FC holds no profile — that lives in the gateway
 * user store since auth moved out of the money core), captured on `ensure`. Reputation defaults to a
 * clear score: reputation may gate table access, never funds, so a default never blocks anything.
 */
export class FcPlayerDirectory implements PlayerDirectory {
  private readonly cache = new Map<string, Cached>();
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly doFetch: typeof fetch;

  constructor(opts: FcDirectoryOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.secret = opts.internalSecret;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  find(playerId: string): TablePlayer | undefined {
    const cached = this.cache.get(playerId);
    return cached ? toPlayer(playerId, cached) : undefined;
  }

  ensure(playerId: string, profile: { displayName?: string; avatarUrl?: string } = {}): TablePlayer {
    const existing = this.cache.get(playerId);
    const entry: Cached = existing ?? { available: 0, displayName: 'Player', reputationScore: 1000 };
    if (profile.displayName) entry.displayName = profile.displayName;
    if (profile.avatarUrl) entry.avatarUrl = profile.avatarUrl;
    this.cache.set(playerId, entry);
    // Never seen them: warm the balance in the background. Sitting comes after joining, and join
    // primes, so by sit-time this is already fresh; a cold read leaves available:0 and the room
    // simply asks them to buy in again.
    if (!existing) void this.prime(playerId);
    return toPlayer(playerId, entry);
  }

  /** Warm a player's real available balance into the cache. Called on join, before they sit. */
  async prime(playerId: string): Promise<void> {
    try {
      const available = await this.fetchAvailableChips(playerId);
      const entry = this.cache.get(playerId) ?? { available, displayName: 'Player', reputationScore: 1000 };
      entry.available = available;
      this.cache.set(playerId, entry);
    } catch (err) {
      console.error('[fc-directory] balance not primed for', playerId, err);
    }
  }

  /** The live buy-in budget for `GET /api/live/chips` — always a fresh read. */
  async availableChips(playerId: string): Promise<number> {
    const available = await this.fetchAvailableChips(playerId);
    const entry = this.cache.get(playerId);
    if (entry) entry.available = available;
    return available;
  }

  private async fetchAvailableChips(playerId: string): Promise<number> {
    const res = await this.doFetch(
      `${this.baseUrl}/internal/accounts/${encodeURIComponent(playerId)}/balance`,
      { headers: { 'x-internal-secret': this.secret } },
    );
    if (!res.ok) throw new Error(`FC balance ${res.status}`);
    const body = (await res.json()) as { available: string };
    return usdtToChips(body.available);
  }
}

function toPlayer(id: string, c: Cached): TablePlayer {
  return {
    id,
    displayName: c.displayName,
    ...(c.avatarUrl ? { avatarUrl: c.avatarUrl } : {}),
    available: c.available,
    reputationScore: c.reputationScore,
  };
}
