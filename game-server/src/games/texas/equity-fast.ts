import { HandCategory, STANDARD_RULES, type HandRank } from './hand-evaluator';

/**
 * A direct best-5-of-N evaluator for STANDARD rules (Texas), built for the insurance equity loop.
 *
 * `evaluateBest` finds the best hand by scoring all C(7,5)=21 five-card subsets — correct, but on the
 * flop the underwriter runs it ~2,000 times per quote (990 runouts × 2 hands) and each call allocates
 * heavily, so a single flop quote took ~1.3s and blocked the event loop (see game-latency.test.ts).
 *
 * This computes the same rank in one pass over rank/suit counts — no subset enumeration, no per-card
 * object allocation. It is deliberately STANDARD-RULES ONLY: insurance is a Texas feature and equity
 * never uses a variant ruleset, so nothing here needs the Short-Deck ordering, and `evaluateBest`
 * remains the single source of truth everywhere else. `bestRankStandard` is proven byte-identical to
 * `evaluateBest(cards, STANDARD_RULES)` across a large random sample + edge cases in equity-fast.test.ts.
 *
 * Only `strength` + `tiebreak` are populated (the fields `compareHands` reads); `cards` is left empty
 * because the equity loop only ever compares ranks, never displays the chosen five.
 */

const RANK: Readonly<Record<string, number>> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};
const SUIT_IDX: Readonly<Record<string, number>> = { s: 0, h: 1, d: 2, c: 3 };

// Reused across calls: bestRankStandard is synchronous and non-reentrant, so a shared scratch buffer
// is safe and avoids per-call allocation in the hot equity loop.
const _rankCount = new Uint8Array(15);
const _suitBits = new Int32Array(4);
const _suitCnt = new Uint8Array(4);

/** Highest card of the best straight in a rank bitmask, or 0. Ace plays low for the wheel (→5). */
function straightFromMask(mask: number): number {
  const m = mask | (mask & (1 << 14) ? 1 << 1 : 0); // A also low
  for (let hi = 14; hi >= 5; hi--) {
    const need = (1 << hi) | (1 << (hi - 1)) | (1 << (hi - 2)) | (1 << (hi - 3)) | (1 << (hi - 4));
    if ((m & need) === need) return hi;
  }
  return 0;
}

// Classifier output, in reused module state (bestRankStandard/scoreStandard are synchronous and
// non-reentrant): the category, the tiebreak length, and up to 5 tiebreak ranks.
let _cat = 0;
let _len = 0;
const _tbuf = new Uint8Array(5);

/** Write the top `n` set ranks of `mask` into `_tbuf` starting at `offset`. */
function fillTop(mask: number, n: number, offset: number): void {
  let count = 0;
  for (let r = 14; r >= 2 && count < n; r--) if (mask & (1 << r)) _tbuf[offset + count++] = r;
}

/**
 * Classify 5–7 cards under standard rules into `_cat` + `_tbuf`/`_len` — the one place the hand logic
 * lives. Allocation-free bitmask evaluation; both public entry points below read this state.
 */
function classify(cards: readonly string[]): void {
  _rankCount.fill(0);
  _suitBits.fill(0);
  _suitCnt.fill(0);
  _tbuf.fill(0);
  let rankMask = 0;

  for (const c of cards) {
    const r = RANK[c[0] ?? ''];
    const si = SUIT_IDX[c[1] ?? ''];
    if (r === undefined || si === undefined) throw new Error(`invalid card: ${c}`);
    _rankCount[r]!++;
    rankMask |= 1 << r;
    _suitBits[si]! |= 1 << r;
    _suitCnt[si]!++;
  }

  let flushBits = 0;
  for (let s = 0; s < 4; s++) if (_suitCnt[s]! >= 5) { flushBits = _suitBits[s]!; break; }

  // Straight flush.
  if (flushBits) {
    const sf = straightFromMask(flushBits);
    if (sf) { _cat = HandCategory.StraightFlush; _tbuf[0] = sf; _len = 1; return; }
  }

  // Group ranks by count (highest of each kind first, scanning 14→2).
  let quad = 0, trip1 = 0, trip2 = 0, pair1 = 0, pair2 = 0;
  for (let r = 14; r >= 2; r--) {
    const c = _rankCount[r]!;
    if (c === 4) { if (!quad) quad = r; }
    else if (c === 3) { if (!trip1) trip1 = r; else if (!trip2) trip2 = r; }
    else if (c === 2) { if (!pair1) pair1 = r; else if (!pair2) pair2 = r; }
  }

  if (quad) {
    _cat = HandCategory.FourOfAKind; _tbuf[0] = quad; fillTop(rankMask & ~(1 << quad), 1, 1); _len = 2; return;
  }
  if (trip1) {
    const pairRank = Math.max(trip2, pair1);
    if (pairRank) { _cat = HandCategory.FullHouse; _tbuf[0] = trip1; _tbuf[1] = pairRank; _len = 2; return; }
  }
  if (flushBits) { _cat = HandCategory.Flush; fillTop(flushBits, 5, 0); _len = 5; return; }

  const s = straightFromMask(rankMask);
  if (s) { _cat = HandCategory.Straight; _tbuf[0] = s; _len = 1; return; }

  if (trip1) { _cat = HandCategory.ThreeOfAKind; _tbuf[0] = trip1; fillTop(rankMask & ~(1 << trip1), 2, 1); _len = 3; return; }
  if (pair1 && pair2) {
    _cat = HandCategory.TwoPair; _tbuf[0] = pair1; _tbuf[1] = pair2; fillTop(rankMask & ~(1 << pair1) & ~(1 << pair2), 1, 2); _len = 3; return;
  }
  if (pair1) { _cat = HandCategory.Pair; _tbuf[0] = pair1; fillTop(rankMask & ~(1 << pair1), 3, 1); _len = 4; return; }

  _cat = HandCategory.HighCard; fillTop(rankMask, 5, 0); _len = 5;
}

/**
 * The best standard-rules poker hand from 5–7 cards, as a rank comparable with `compareHands`.
 * Proven byte-identical to evaluateBest in equity-fast.test.ts. (API/test entry point.)
 */
export function bestRankStandard(cards: readonly string[]): HandRank {
  classify(cards);
  const tiebreak: number[] = [];
  for (let i = 0; i < _len; i++) tiebreak.push(_tbuf[i]!);
  return { category: _cat, strength: STANDARD_RULES.order[_cat as HandCategory], tiebreak, cards: [] };
}

/**
 * The same hand as a single packed integer that TOTAL-ORDERS exactly as compareHands would: category
 * in the top field, then 5 tiebreak slots (zero-padded), most significant first. Allocation-free — no
 * object, no array, no compareHands — this is what the equity hot loop uses. Ordering equivalence to
 * compareHands is proven in equity-fast.test.ts.
 */
export function scoreStandard(cards: readonly string[]): number {
  classify(cards);
  return (_cat << 20) | (_tbuf[0]! << 16) | (_tbuf[1]! << 12) | (_tbuf[2]! << 8) | (_tbuf[3]! << 4) | _tbuf[4]!;
}
