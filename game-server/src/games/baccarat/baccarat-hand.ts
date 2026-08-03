/**
 * Baccarat hand engine — deals Player and Banker from a shuffled deck and resolves the outcome by
 * the standard fixed rules (no player decisions). The subtle part is the third-card "tableau":
 * naturals stand; the Player draws on 0–5; the Banker draws per a table that depends on the Banker
 * total and the Player's third card.
 *
 * Card values: A = 1, 2–9 = pip, 10/J/Q/K = 0. A hand's total is the sum mod 10.
 */

export type BaccaratOutcome = 'PLAYER' | 'BANKER' | 'TIE';

export interface BaccaratResult {
  playerCards: string[];
  bankerCards: string[];
  playerTotal: number;
  bankerTotal: number;
  outcome: BaccaratOutcome;
}

export function cardValue(card: string): number {
  const rank = card[0] ?? '';
  if (rank === 'A') return 1;
  if (rank === 'T' || rank === 'J' || rank === 'Q' || rank === 'K') return 0;
  return Number(rank);
}

export function handTotal(cards: readonly string[]): number {
  return cards.reduce((sum, c) => sum + cardValue(c), 0) % 10;
}

/** Does the Banker draw a third card, given its total and the Player's third card (if any)? */
function bankerDraws(bankerTotal: number, playerThird: number | undefined): boolean {
  if (playerThird === undefined) {
    // Player stood (6–7): Banker draws on 0–5.
    return bankerTotal <= 5;
  }
  const p = playerThird;
  switch (bankerTotal) {
    case 0:
    case 1:
    case 2:
      return true;
    case 3:
      return p !== 8;
    case 4:
      return p >= 2 && p <= 7;
    case 5:
      return p >= 4 && p <= 7;
    case 6:
      return p >= 6 && p <= 7;
    default:
      return false; // 7 stands
  }
}

/** Play a baccarat hand from the top of `deck` (deal order: Player, Banker, Player, Banker). */
export function playBaccarat(deck: readonly string[]): BaccaratResult {
  const player = [deck[0]!, deck[2]!];
  const banker = [deck[1]!, deck[3]!];
  let next = 4;

  let playerTotal = handTotal(player);
  let bankerTotal = handTotal(banker);

  // No natural (8 or 9 either side) → apply the drawing rules.
  if (playerTotal < 8 && bankerTotal < 8) {
    let playerThird: number | undefined;
    if (playerTotal <= 5) {
      const c = deck[next++]!;
      player.push(c);
      playerThird = cardValue(c);
      playerTotal = handTotal(player);
    }
    if (bankerDraws(bankerTotal, playerThird)) {
      banker.push(deck[next++]!);
      bankerTotal = handTotal(banker);
    }
  }

  const outcome: BaccaratOutcome =
    playerTotal > bankerTotal ? 'PLAYER' : bankerTotal > playerTotal ? 'BANKER' : 'TIE';

  return { playerCards: player, bankerCards: banker, playerTotal, bankerTotal, outcome };
}
