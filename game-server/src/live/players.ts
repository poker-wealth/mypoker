import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The seam between the live table and whoever owns identity + money.
 *
 * The table never asks how a player signed in or where their money lives. It asks two things:
 *   - `PlayerDirectory` — who is the player behind this session token (name, avatar, bankroll)?
 *   - `ChipLedger`      — move chips between "available" and "locked at a table".
 *
 * That keeps this module independent of the auth track (Telegram `initData` → account) and the
 * Financial Core: they implement these two interfaces and no table code changes.
 *
 * `DevPlayers` implements both against a JSON file so real people can sit down and play today,
 * before either track lands. It is the ONLY thing here to throw away later.
 */

export interface TablePlayer {
  id: string;
  displayName: string;
  avatarUrl?: string;
  /** Chips they can still buy in with (not already locked at a table). */
  available: number;
  reputationScore: number;
}

export interface PlayerDirectory {
  find(playerId: string): TablePlayer | undefined;
  /**
   * Called when someone sits down, so the implementation can create its local record for a player
   * it hasn't seen before. `profile` is the display name/avatar the client supplied — a HINT for
   * drawing the seat, never identity: who the player is comes from the verified token alone.
   * Optional; directories that already know every player can leave it out.
   */
  ensure?(playerId: string, profile?: { displayName?: string; avatarUrl?: string }): TablePlayer;
}

/**
 * Chip custody. Mirrors the Financial Core's available/locked model: buying in locks chips at the
 * table, standing up releases them, and a settled hand shifts locked chips between players.
 */
export interface ChipLedger {
  available(playerId: string): number;
  /** available → locked (buy-in). Throws if they can't cover it. */
  lock(playerId: string, amount: number): void;
  /** locked → available (leaving the table). */
  unlock(playerId: string, amount: number): void;
  /** Settlement: shift a player's locked stack (winners +, losers −). */
  adjustLocked(playerId: string, delta: number): void;
}

export class PlayerError extends Error {}

export interface DevPlayerRecord {
  id: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
  vipTier: number;
  available: number;
  locked: number;
  reputationScore: number;
}

export interface DevPlayersOptions {
  /** JSON file to persist to. Omit for in-memory only (tests). */
  file?: string;
  /** Chips a player starts with the first time they appear. */
  startingChips?: number;
}

/**
 * Development stand-in: a persisted player list with chip balances.
 *
 * Players appear the first time a session token names them (`ensure`), so the table is playable
 * the moment two people open it. Replace with the real account service.
 */
export class DevPlayers implements PlayerDirectory, ChipLedger {
  private readonly players = new Map<string, DevPlayerRecord>();
  private readonly file: string | undefined;
  readonly startingChips: number;

  constructor(opts: DevPlayersOptions = {}) {
    this.file = opts.file;
    this.startingChips = opts.startingChips ?? 10_000;
    this.load();
  }

  /** Get the player, creating them on first sight. */
  ensure(playerId: string, profile: { displayName?: string; avatarUrl?: string } = {}): TablePlayer {
    let record = this.players.get(playerId);
    if (!record) {
      record = {
        id: playerId,
        displayName: profile.displayName ?? `Player ${this.players.size + 1}`,
        ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        available: this.startingChips,
        locked: 0,
        vipTier: 0,
        reputationScore: 1000,
      };
      this.players.set(playerId, record);
      this.save();
    } else if (profile.displayName && profile.displayName !== record.displayName) {
      record.displayName = profile.displayName;
      if (profile.avatarUrl) record.avatarUrl = profile.avatarUrl;
      this.save();
    }
    return toTablePlayer(record);
  }

  /** Register a fresh player under a generated id (the dev sign-in path). */
  create(displayName: string, avatarUrl?: string): TablePlayer {
    return this.ensure(randomUUID(), { displayName, ...(avatarUrl ? { avatarUrl } : {}) });
  }

  find(playerId: string): TablePlayer | undefined {
    const record = this.players.get(playerId);
    return record ? toTablePlayer(record) : undefined;
  }

  list(): TablePlayer[] {
    return [...this.players.values()].map(toTablePlayer);
  }

  available(playerId: string): number {
    return this.require(playerId).available;
  }

  /** Chips currently sitting in front of them at a table. */
  locked(playerId: string): number {
    return this.require(playerId).locked;
  }

  lock(playerId: string, amount: number): void {
    const record = this.require(playerId);
    assertPositive(amount);
    if (record.available < amount) throw new PlayerError('not enough chips');
    record.available -= amount;
    record.locked += amount;
    this.save();
  }

  unlock(playerId: string, amount: number): void {
    const record = this.require(playerId);
    assertPositive(amount);
    if (record.locked < amount) throw new PlayerError('cannot release more than is locked');
    record.locked -= amount;
    record.available += amount;
    this.save();
  }

  adjustLocked(playerId: string, delta: number): void {
    const record = this.require(playerId);
    if (record.locked + delta < 0) throw new PlayerError('settlement would overdraw a stack');
    record.locked += delta;
    this.save();
  }

  /** Every chip held by a player, seated or not — the invariant conservation tests assert on. */
  totalChips(): number {
    return [...this.players.values()].reduce((sum, p) => sum + p.available + p.locked, 0);
  }

  private require(playerId: string): DevPlayerRecord {
    const record = this.players.get(playerId);
    if (!record) throw new PlayerError(`unknown player: ${playerId}`);
    return record;
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { players?: DevPlayerRecord[] };
      for (const record of raw.players ?? []) this.players.set(record.id, record);
    } catch {
      // A corrupt dev file must not take the table down — start empty and rewrite on next save.
      console.warn(`[players] could not read ${this.file}; starting empty`);
    }
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ players: [...this.players.values()] }, null, 2));
    renameSync(tmp, this.file); // atomic: a crash mid-write can't leave a half-written file
  }
}

function toTablePlayer(record: DevPlayerRecord): TablePlayer {
  return {
    id: record.id,
    displayName: record.displayName,
    ...(record.avatarUrl ? { avatarUrl: record.avatarUrl } : {}),
    available: record.available,
    reputationScore: record.reputationScore,
  };
}

function assertPositive(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) throw new PlayerError('amount must be a positive integer');
}
