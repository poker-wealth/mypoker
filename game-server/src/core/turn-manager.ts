/**
 * TurnManager — turn order for a seated, turn-based game.
 *
 * Tracks who is active (not folded/left), whose turn it is, and who has acted in the current
 * betting round. Games drive it: read `current`, let that player act, `markActed`, then `advance`.
 * A round is complete when every active player has acted; `resetRound` starts the next street.
 */
export class TurnManager {
  private readonly seatOrder: string[];
  private readonly active: Set<string>;
  private readonly acted = new Set<string>();
  private idx = 0;

  constructor(seatOrder: readonly string[]) {
    if (seatOrder.length === 0) throw new Error('TurnManager requires at least one player');
    this.seatOrder = [...seatOrder];
    this.active = new Set(seatOrder);
  }

  /** The player whose turn it is, or null if no one is active. */
  get current(): string | null {
    const id = this.seatOrder[this.idx];
    return id !== undefined && this.active.has(id) ? id : null;
  }

  /** Advance to the next active player (wraps; returns the same player if they're the only one left). */
  advance(): string | null {
    const len = this.seatOrder.length;
    for (let i = 1; i <= len; i++) {
      const id = this.seatOrder[(this.idx + i) % len];
      if (id !== undefined && this.active.has(id)) {
        this.idx = (this.idx + i) % len;
        return id;
      }
    }
    return null; // no active players
  }

  markActed(playerId: string): void {
    if (this.active.has(playerId)) this.acted.add(playerId);
  }

  hasActed(playerId: string): boolean {
    return this.acted.has(playerId);
  }

  /** True once every active player has acted this round. */
  isRoundComplete(): boolean {
    const players = this.activePlayers();
    return players.length > 0 && players.every((p) => this.acted.has(p));
  }

  /** Start a new betting round: clear who has acted, keep who is active. */
  resetRound(): void {
    this.acted.clear();
  }

  /** Remove a player (fold or leave). If it was their turn, the pointer moves to the next active. */
  remove(playerId: string): void {
    const wasCurrent = this.current === playerId;
    this.active.delete(playerId);
    this.acted.delete(playerId);
    if (wasCurrent) this.advance();
  }

  activePlayers(): string[] {
    return this.seatOrder.filter((p) => this.active.has(p));
  }

  get activeCount(): number {
    return this.active.size;
  }

  isActive(playerId: string): boolean {
    return this.active.has(playerId);
  }
}
