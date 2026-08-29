import { ComboType, type Combo } from './combos';
import { cardRank } from './ddz-deck';
import { validateMove } from './validator';

export type AiDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface GameStateContext {
  isLandlord: boolean;
  landlordPlayerId: string;
  myPlayerId: string;
  lastPlayPlayerId?: string;
  opponentCardCounts: Record<string, number>;
}

/**
 * Evaluates hand strength for bidding (returns 0..3 bid points).
 */
export function evaluateBidding(hand: string[], difficulty: AiDifficulty = 'HARD'): number {
  const ranks = hand.map(cardRank);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);

  let score = 0;
  // Jokers
  if (counts.get(16)) score += 2;
  if (counts.get(17)) score += 3;
  if (counts.get(16) && counts.get(17)) score += 2; // Rocket bonus

  // 2s (rank 15)
  score += (counts.get(15) ?? 0) * 2;

  // Bombs
  for (const [, c] of counts) {
    if (c === 4) score += 4;
    else if (c === 3) score += 1.5;
  }

  if (difficulty === 'EASY') return Math.min(3, Math.floor(score / 4));
  if (difficulty === 'MEDIUM') return Math.min(3, Math.floor(score / 3.5));

  if (score >= 9) return 3;
  if (score >= 6) return 2;
  if (score >= 3.5) return 1;
  return 0;
}

/**
 * Generate all subsets of hand cards up to size maxK that form valid combinations.
 */
export function findAllLegalMoves(hand: string[], previousCombo: Combo | null): { cards: string[]; combo: Combo }[] {
  const legalMoves: { cards: string[]; combo: Combo }[] = [];

  const ranksMap = new Map<number, string[]>();
  for (const c of hand) {
    const r = cardRank(c);
    let arr = ranksMap.get(r);
    if (!arr) {
      arr = [];
      ranksMap.set(r, arr);
    }
    arr.push(c);
  }

  const sortedRanks = [...ranksMap.keys()].sort((a, b) => a - b);

  // Singles
  for (const r of sortedRanks) {
    const cards = [ranksMap.get(r)![0]!];
    const res = validateMove(cards, previousCombo, hand);
    if (res.valid && res.combination) legalMoves.push({ cards, combo: res.combination });
  }

  // Pairs
  for (const r of sortedRanks) {
    const cards = ranksMap.get(r)!;
    if (cards.length >= 2) {
      const pairCards = cards.slice(0, 2);
      const res = validateMove(pairCards, previousCombo, hand);
      if (res.valid && res.combination) legalMoves.push({ cards: pairCards, combo: res.combination });
    }
  }

  // Triplets & Triple+1 & Triple+2
  for (const r of sortedRanks) {
    const cards = ranksMap.get(r)!;
    if (cards.length >= 3) {
      const tripCards = cards.slice(0, 3);
      let res = validateMove(tripCards, previousCombo, hand);
      if (res.valid && res.combination) legalMoves.push({ cards: tripCards, combo: res.combination });

      // Add single attachment
      for (const r2 of sortedRanks) {
        if (r2 !== r) {
          const single = ranksMap.get(r2)![0]!;
          const t1 = [...tripCards, single];
          res = validateMove(t1, previousCombo, hand);
          if (res.valid && res.combination) legalMoves.push({ cards: t1, combo: res.combination });
        }
      }

      // Add pair attachment
      for (const r2 of sortedRanks) {
        if (r2 !== r && ranksMap.get(r2)!.length >= 2) {
          const pair = ranksMap.get(r2)!.slice(0, 2);
          const t2 = [...tripCards, ...pair];
          res = validateMove(t2, previousCombo, hand);
          if (res.valid && res.combination) legalMoves.push({ cards: t2, combo: res.combination });
        }
      }
    }
  }

  // Bombs (4 of a kind)
  for (const r of sortedRanks) {
    const cards = ranksMap.get(r)!;
    if (cards.length === 4) {
      const res = validateMove(cards, previousCombo, hand);
      if (res.valid && res.combination) legalMoves.push({ cards, combo: res.combination });
    }
  }

  // Rocket (BJ + RJ)
  if (ranksMap.get(16)?.length && ranksMap.get(17)?.length) {
    const rocket = [ranksMap.get(16)![0]!, ranksMap.get(17)![0]!];
    const res = validateMove(rocket, previousCombo, hand);
    if (res.valid && res.combination) legalMoves.push({ cards: rocket, combo: res.combination });
  }

  /**
   * Pair-straights and airplanes.
   *
   * These were missing, and a shape the AI cannot GENERATE is a shape it cannot answer: holding
   * 666 777 against an airplane of 444 555 it passed and then dumped those cards as singles. Both
   * are runs of a repeated group, so they are built the same way — take every consecutive window
   * of ranks that has enough copies, then hang the wings off the airplane cores.
   */
  const runsOf = (copies: number, minLength: number): number[][] => {
    const eligible = sortedRanks.filter((r) => r <= 14 && ranksMap.get(r)!.length >= copies);
    const windows: number[][] = [];
    for (let start = 0; start < eligible.length; start++) {
      const run: number[] = [eligible[start]!];
      for (let i = start + 1; i < eligible.length && eligible[i] === run[run.length - 1]! + 1; i++) {
        run.push(eligible[i]!);
      }
      // Every window of at least the minimum length, so the AI can play the SHORT one when the
      // long one would break a hand it wants to keep.
      for (let len = minLength; len <= run.length; len++) {
        for (let offset = 0; offset + len <= run.length; offset++) {
          windows.push(run.slice(offset, offset + len));
        }
      }
    }
    return windows;
  };

  const take = (rank: number, n: number): string[] => ranksMap.get(rank)!.slice(0, n);

  // Consecutive pairs: 3 or more.
  for (const window of runsOf(2, 3)) {
    const cards = window.flatMap((r) => take(r, 2));
    const res = validateMove(cards, previousCombo, hand);
    if (res.valid && res.combination) legalMoves.push({ cards, combo: res.combination });
  }

  // Airplanes: 2+ consecutive triples, bare or with one single / one pair per triple.
  for (const window of runsOf(3, 2)) {
    const core = window.flatMap((r) => take(r, 3));
    const bare = validateMove(core, previousCombo, hand);
    if (bare.valid && bare.combination) legalMoves.push({ cards: core, combo: bare.combination });

    const k = window.length;
    const spare = sortedRanks.filter((r) => !window.includes(r));

    // Cheapest wings first: the lowest cards that are not part of the core.
    const singleWings = spare.slice(0, k).flatMap((r) => take(r, 1));
    if (singleWings.length === k) {
      const cards = [...core, ...singleWings];
      const res = validateMove(cards, previousCombo, hand);
      if (res.valid && res.combination) legalMoves.push({ cards, combo: res.combination });
    }

    const pairRanks = spare.filter((r) => ranksMap.get(r)!.length >= 2).slice(0, k);
    if (pairRanks.length === k) {
      const cards = [...core, ...pairRanks.flatMap((r) => take(r, 2))];
      const res = validateMove(cards, previousCombo, hand);
      if (res.valid && res.combination) legalMoves.push({ cards, combo: res.combination });
    }
  }

  /**
   * Four-with-two — a quad plus two loose singles, or a quad plus two pairs.
   *
   * These were missing for the same reason pair-straights once were, but this
   * one costs money rather than tempo. Four-with-two is NOT a bomb (see
   * classifyPlay: it is deliberately its own shape, beaten by any bomb), so
   * with the generator skipping it the ONLY way the AI could answer one was to
   * detonate the quad as a bomb — and a bomb doubles the round multiplier
   * (dou-di-zhu-game.ts). Answering four-with-two in kind leaves the stake
   * where it is; every hand the AI plays it as a bomb doubles what the table
   * pays out. It also could not lead the shape at all, so it never shed two
   * dead cards behind a quad.
   *
   * Wings are cheapest-first, as with airplanes: only the quad's rank enters
   * the comparison, so one attachment per quad is enough to answer wherever an
   * answer is legal.
   */
  for (const q of sortedRanks) {
    if (ranksMap.get(q)!.length !== 4) continue;
    const core = take(q, 4);
    const spare = sortedRanks.filter((r) => r !== q);

    // Two lowest cards not in the quad. sortedRanks is ascending, so this is
    // the cheapest pair of cards available — and it reaches the jokers only
    // when there is genuinely nothing else to hang off the quad.
    const loose = spare.flatMap((r) => ranksMap.get(r)!).slice(0, 2);
    if (loose.length === 2) {
      const cards = [...core, ...loose];
      const res = validateMove(cards, previousCombo, hand);
      if (res.valid && res.combination) legalMoves.push({ cards, combo: res.combination });
    }

    const wingPairs = spare.filter((r) => ranksMap.get(r)!.length >= 2).slice(0, 2);
    if (wingPairs.length === 2) {
      const cards = [...core, ...wingPairs.flatMap((r) => take(r, 2))];
      const res = validateMove(cards, previousCombo, hand);
      if (res.valid && res.combination) legalMoves.push({ cards, combo: res.combination });
    }
  }

  // Straights (5 to 12 consecutive singles, <= 14)
  const validSeqRanks = sortedRanks.filter((r) => r <= 14);
  for (let len = 5; len <= validSeqRanks.length; len++) {
    for (let i = 0; i <= validSeqRanks.length - len; i++) {
      const slice = validSeqRanks.slice(i, i + len);
      let isCon = true;
      for (let k = 1; k < slice.length; k++) {
        if (slice[k]! !== slice[k - 1]! + 1) {
          isCon = false;
          break;
        }
      }
      if (isCon) {
        const strCards = slice.map((r) => ranksMap.get(r)![0]!);
        const res = validateMove(strCards, previousCombo, hand);
        if (res.valid && res.combination) legalMoves.push({ cards: strCards, combo: res.combination });
      }
    }
  }

  return legalMoves;
}

export interface HandAnalysis {
  /** Higher is stronger. Combines raw card power with how easily the hand empties. */
  score: number;
  /** Plays needed to empty the hand, decomposed greedily largest-first. */
  combinationsNeeded: number;
  bombs: number;
  hasRocket: boolean;
  twos: number;
}

/**
 * How good is this hand to PLAY (not to bid on).
 *
 * The count that decides most hands is `combinationsNeeded`: twenty cards that leave in four plays
 * beat twelve that need eight, because every play you need is a turn an opponent gets to take the
 * lead back. Raw power — jokers, 2s, bombs — is added on top, and the shortfall in plays is
 * charged against it.
 *
 * Greedy rather than optimal: take the biggest legal play, repeat. Exact decomposition is a search
 * problem and this is consulted on every AI turn.
 */
export function analyseHand(hand: string[]): HandAnalysis {
  const ranks = hand.map(cardRank);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);

  const bombs = [...counts.values()].filter((c) => c === 4).length;
  const hasRocket = Boolean(counts.get(16) && counts.get(17));
  const twos = counts.get(15) ?? 0;

  const remaining = [...hand];
  let combinationsNeeded = 0;
  while (remaining.length > 0 && combinationsNeeded < 30) {
    const moves = findAllLegalMoves(remaining, null);
    if (moves.length === 0) {
      combinationsNeeded += remaining.length; // singles, one turn each
      break;
    }
    // Biggest play that is not a bomb or rocket — those are answers, not a way to empty a hand.
    const usable = moves.filter(
      (m) => m.combo.type !== ComboType.Bomb && m.combo.type !== ComboType.Rocket,
    );
    const best = (usable.length > 0 ? usable : moves).reduce((a, b) =>
      b.cards.length > a.cards.length ? b : a,
    );
    for (const card of best.cards) remaining.splice(remaining.indexOf(card), 1);
    combinationsNeeded += 1;
  }
  combinationsNeeded += bombs + (hasRocket ? 1 : 0);

  const power = bombs * 8 + (hasRocket ? 10 : 0) + twos * 3 + ranks.filter((r) => r === 14).length;
  const score = power - combinationsNeeded * 2;

  return { score, combinationsNeeded, bombs, hasRocket, twos };
}

/** The strategic value of a hand as a single number (§17). */
export function evaluateHand(hand: string[]): number {
  return analyseHand(hand).score;
}

/**
 * AI move selection for Easy, Medium, and Hard difficulty levels.
 */
export function chooseBestMove(
  hand: string[],
  previousCombo: Combo | null,
  difficulty: AiDifficulty = 'HARD',
  ctx?: GameStateContext,
): string[] | null {
  const moves = findAllLegalMoves(hand, previousCombo);

  // If leading (previousCombo is null) and no moves found (should not happen), return first single
  if (!previousCombo) {
    if (moves.length === 0) return [hand[0]!];
  } else {
    if (moves.length === 0) return null; // Must pass if cannot beat
  }

  if (difficulty === 'EASY') {
    // Easy: pick lowest valid move that beats previous, or pass 50% when optional
    if (!previousCombo) return moves[0]!.cards;
    return moves[0]?.cards ?? null;
  }

  if (difficulty === 'MEDIUM') {
    // Medium: sort by rank ascending; avoid using bombs unless no normal move works
    const nonBombs = moves.filter((m) => m.combo.type !== ComboType.Bomb && m.combo.type !== ComboType.Rocket);
    if (nonBombs.length > 0) {
      return nonBombs[0]!.cards;
    }
    // If only bomb/rocket beats previous, use bomb if hand is small (<= 5) or previous is high
    if (hand.length <= 6 || (previousCombo && previousCombo.rank >= 13)) {
      return moves[0]!.cards;
    }
    return previousCombo ? null : moves[0]!.cards;
  }

  // HARD AI Logic
  // 1. Check opponent threat level (if enemy has 1-2 cards left)
  let enemyThreat = false;
  if (ctx && ctx.opponentCardCounts) {
    for (const [pId, cnt] of Object.entries(ctx.opponentCardCounts)) {
      if (pId !== ctx.myPlayerId) {
        const isEnemy = ctx.isLandlord || (ctx.landlordPlayerId === pId);
        if (isEnemy && cnt <= 2) {
          enemyThreat = true;
          break;
        }
      }
    }
  }

  // 2. Partner cooperation: if Peasant and partner made last play, don't overbeat unless necessary
  if (ctx && !ctx.isLandlord && ctx.lastPlayPlayerId && ctx.lastPlayPlayerId !== ctx.landlordPlayerId && previousCombo) {
    if (previousCombo.rank >= 11) return null; // Trust partner's high lead
  }

  // 3. Filter moves: prefer non-bomb moves first
  const nonBombs = moves.filter((m) => m.combo.type !== ComboType.Bomb && m.combo.type !== ComboType.Rocket);

  if (nonBombs.length > 0) {
    // Pick the lowest rank non-bomb move that satisfies condition
    nonBombs.sort((a, b) => a.combo.rank - b.combo.rank);
    return nonBombs[0]!.cards;
  }

  // 4. If only bombs/rocket available:
  if (enemyThreat || hand.length <= 4 || (previousCombo && previousCombo.rank >= 14)) {
    moves.sort((a, b) => a.combo.rank - b.combo.rank);
    return moves[0]!.cards;
  }

  return previousCombo ? null : moves[0]!.cards;
}
