import { JackpotEngine, type JackpotHit } from '../jackpot/jackpot-engine';
import type { JackpotCandidate } from '../jackpot/weights';
import type { JackpotWinSnapshot } from './room-state';

/**
 * RoomJackpot — generalized jackpot hit manager for all live tables.
 *
 * Tracks the 4 jackpot pools (MINI, MINOR, MAJOR, GRAND), processes injections from winning
 * profits at hand settlement, evaluates hits, and exposes the latest JackpotWinSnapshot for
 * broadcast snapshots.
 */
export class RoomJackpot {
  private readonly engine: JackpotEngine;
  private lastWin: JackpotWinSnapshot | null = null;

  constructor(readonly tableId: string) {
    this.engine = new JackpotEngine(tableId);
  }

  /**
   * Called on hand settlement with winner profit and seated candidates.
   */
  evaluateHand(
    winnerProfit: number,
    candidates: readonly JackpotCandidate[],
    roundId: string,
    seed: string,
    playerNameMap?: (playerId: string) => string,
  ): JackpotHit[] {
    if (winnerProfit > 0) {
      this.engine.inject(winnerProfit);
    }

    const hits = this.engine.onRoundSettled({
      roundId,
      seed,
      now: Date.now(),
      candidates,
    });

    if (hits.length > 0) {
      const hit = hits[hits.length - 1]!;
      const playerName = playerNameMap ? playerNameMap(hit.playerId) : hit.playerId;
      this.lastWin = {
        tier: hit.tier,
        playerId: hit.playerId,
        playerName,
        amount: hit.amount,
        animationMs: hit.animationMs,
        roundId: hit.roundId,
      };
    }

    return hits;
  }

  snapshot(): JackpotWinSnapshot | null {
    return this.lastWin;
  }

  getEngine(): JackpotEngine {
    return this.engine;
  }
}
