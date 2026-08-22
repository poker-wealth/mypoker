import { StyleSheet, Text, View } from 'react-native';

/**
 * A single playing card.
 *
 * Ported from `frontend/src/components/poker/PlayingCard.tsx`. The web version is a div with a
 * Tailwind class per size and an SVG-ish back; here it is a View with a StyleSheet, because React
 * Native has neither. Same three sizes and the same face-down behaviour, so a felt reads the same
 * on both platforms.
 *
 * The card string is the server's: rank then suit, `As` / `Th` / `2c`, plus `jb` and `js` for the
 * two jokers Dou Di Zhu uses. Anything unparseable draws face-down rather than throwing — a bad
 * card should cost you one card, not the table.
 */

export type CardSize = 'sm' | 'md' | 'lg';

const SIZES: Record<CardSize, { width: number; height: number; rank: number; suit: number }> = {
  sm: { width: 32, height: 44, rank: 11, suit: 13 },
  md: { width: 44, height: 64, rank: 14, suit: 17 },
  lg: { width: 56, height: 80, rank: 17, suit: 21 },
};

const SUIT_GLYPH: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = new Set(['h', 'd']);

export interface PlayingCardProps {
  /** Engine string like 'As'. Omitted or null draws the back. */
  card?: string | null;
  faceDown?: boolean;
  size?: CardSize;
}

export function PlayingCard({ card, faceDown, size = 'md' }: PlayingCardProps) {
  const s = SIZES[size];
  const down = faceDown || !card;

  if (down) {
    return (
      <View style={[styles.card, styles.back, { width: s.width, height: s.height }]}>
        <View style={styles.backInner} />
      </View>
    );
  }

  // Jokers carry no suit; everything else is <rank><suit>.
  const isJoker = card === 'jb' || card === 'js';
  const rank = isJoker ? 'JKR' : card!.slice(0, -1);
  const suitKey = isJoker ? '' : card!.slice(-1);
  const glyph = SUIT_GLYPH[suitKey] ?? '';
  const red = isJoker ? card === 'jb' : RED_SUITS.has(suitKey);

  // Unparseable rather than merely unusual: draw the back instead of a card reading "undefined".
  if (!isJoker && !glyph) {
    return (
      <View style={[styles.card, styles.back, { width: s.width, height: s.height }]}>
        <View style={styles.backInner} />
      </View>
    );
  }

  return (
    <View style={[styles.card, styles.face, { width: s.width, height: s.height }]}>
      <Text
        style={[styles.rank, { fontSize: s.rank, color: red ? '#dc2626' : '#111827' }]}
        numberOfLines={1}
      >
        {rank}
      </Text>
      <Text style={[styles.suit, { fontSize: s.suit, color: red ? '#dc2626' : '#111827' }]}>
        {glyph}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 6,
    justifyContent: 'space-between',
    paddingHorizontal: 3,
    paddingVertical: 2,
    // RN has no box-shadow; elevation on Android and shadow* on iOS are the equivalents.
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  face: { backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' },
  back: {
    backgroundColor: '#1e1b4b',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    padding: 4,
  },
  backInner: {
    flex: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    backgroundColor: '#312e81',
  },
  rank: { fontWeight: '800', lineHeight: undefined },
  suit: { alignSelf: 'flex-end', lineHeight: undefined },
});
