import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

/**
 * A jackpot firing.
 *
 * Ported from `frontend/src/components/poker/JackpotBurst.tsx`. Shown to EVERY viewer, because a
 * jackpot is table news rather than a private message, and it runs for the duration the SERVER
 * sends — the room decides how long its own celebration lasts, not the client.
 *
 * Gold is used here and, per the brand rules, essentially nowhere else: it means a jackpot.
 */

export interface JackpotBurstProps {
  tier: 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND';
  playerName: string;
  /** Table currency (chips). */
  amount: number;
  animationMs: number;
  onDone: () => void;
}

export function JackpotBurst({ tier, playerName, amount, animationMs, onDone }: JackpotBurstProps) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.sequence([
      Animated.timing(enter, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.back(1.6)),
        useNativeDriver: true,
      }),
      // Hold for whatever the server asked for, less the entry and exit.
      Animated.delay(Math.max(0, animationMs - 520)),
      Animated.timing(enter, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier, playerName, amount, animationMs]);

  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View style={[styles.card, { opacity: enter, transform: [{ scale }] }]}>
        <Text style={styles.tier}>{tier} JACKPOT</Text>
        <Text style={styles.amount}>₮{amount}</Text>
        <Text style={styles.who}>{playerName}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  card: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 28,
    paddingVertical: 20,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: theme.jackpot,
    backgroundColor: 'rgba(0,0,0,0.82)',
  },
  tier: { color: theme.jackpot, fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  amount: { color: theme.jackpot, fontSize: 38, fontWeight: '900' },
  who: { color: theme.text, fontSize: 14, fontWeight: '600' },
});
