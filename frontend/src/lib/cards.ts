/**
 * Card helpers matching the game-server's string format ('As', 'Td', '9c', 'Kh').
 * Rank chars: 2-9, T, J, Q, K, A. Suit chars: s(pades) h(earts) d(iamonds) c(lubs).
 * Keeping this identical to the engine means the table renders real hand data unchanged.
 */
export type Card = string;

export const SUIT_GLYPH: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

/** Hearts & diamonds render red; spades & clubs render on the light face as near-black. */
export const isRedSuit = (card: Card): boolean => card[1] === 'h' || card[1] === 'd';

export const rankOf = (card: Card): string => (card[0] === 'T' ? '10' : card[0]);
export const suitOf = (card: Card): string => SUIT_GLYPH[card[1]] ?? '?';

/** A full 52-card deck in engine string form — handy for demos/animations. */
export function fullDeck(): Card[] {
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const suits = ['s', 'h', 'd', 'c'];
  return suits.flatMap((s) => ranks.map((r) => r + s));
}
