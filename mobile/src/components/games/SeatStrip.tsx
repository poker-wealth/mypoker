import { StyleSheet, Text, View } from 'react-native';
import { radius, space, theme } from '../../theme';
import type { LiveSeat } from '../../lib/liveTable';

/**
 * Who else is at the table, and what they have riding on this round.
 *
 * Ported from `frontend/src/components/games/SeatStrip.tsx`. Several felts drew only your own
 * controls, so a practice table looked empty even with three players in it — you could not see the
 * opponents you were betting against, or that they were house AI.
 *
 * A chair is labelled AI only when the server says `isBot`: at a table of real people, nobody is.
 *
 * The web version uses lucide icons for the two avatars; there is no icon library here and adding
 * one for two glyphs is not worth the bundle, so the avatar is a letter.
 */
export function SeatStrip({
  seats,
  accent = theme.jackpot,
}: {
  seats: LiveSeat[];
  accent?: string;
}) {
  const taken = seats.filter((s) => s.playerId);
  if (taken.length === 0) return null;

  return (
    <View style={styles.strip}>
      {taken.map((seat) => (
        <View
          key={seat.index}
          style={[styles.seat, seat.isWinner && { borderColor: accent, backgroundColor: 'rgba(255,255,255,0.1)' }]}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{seat.isBot ? 'AI' : seat.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View>
            <Text style={styles.name} numberOfLines={1}>
              {seat.name}
              {seat.isYou ? ' (you)' : seat.isBot ? ' · AI' : ''}
            </Text>
            <Text style={styles.meta}>
              ₮{seat.stack.toLocaleString()}
              {seat.bet > 0 ? ` · bet ₮${seat.bet.toLocaleString()}` : ''}
              {seat.lastAction ? ` · ${seat.lastAction}` : ''}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  seat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: theme.text, fontSize: 10, fontWeight: '800' },
  name: { color: theme.text, fontSize: 12, fontWeight: '700' },
  meta: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
});
