import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { chips } from '../../lib/money';
import { radius, space, theme } from '../../theme';

/**
 * The all-in insurance prompt.
 *
 * Ported from `frontend/src/components/poker/InsurancePrompt.tsx`.
 *
 * Takes a quote and nothing else. There is deliberately no snapshot, no exposure, no risk
 * multiplier in these props — the spec says the UI shows "final odds number ONLY. No RiskFactor. No
 * calculation details", and the cheapest way to honour that is a component that never receives
 * them. It cannot leak what it was never given.
 *
 * Rendering is the caller's decision, not this component's. The spec's skip rule for three or more
 * all-in players is "silently skips" — so the prompt must not mount at all in that case, rather
 * than mounting and declining. A prompt that appears and then refuses still tells the table
 * something happened.
 *
 * The timer matters as much as the odds. An insurance decision sits between a player and a hand
 * they are already all-in on, so it takes the decision away on expiry rather than blocking the
 * table indefinitely.
 */

/**
 * Exactly the shape game-server/src/games/texas/underwriting.ts already emits.
 *
 * Mirrored rather than redefined: that module is the one the engine calls, and a second definition
 * of "what a quote is" would drift into showing a number the server never sent.
 */
export interface InsuranceQuote {
  /** What the player pays, micro-USD. */
  premium: number;
  /** What they receive if the hand goes against them, micro-USD. */
  coverage: number;
  /**
   * coverage / premium — e.g. 20 means "pay 5 to receive 100". The only derived figure the UI
   * shows, and the only one it is given.
   */
  payoutOdds: number;
}

export function InsurancePrompt({
  quote,
  seconds = 10,
  onAccept,
  onDecline,
}: {
  /** Null when no insurance is offered — the prompt simply does not appear. */
  quote: InsuranceQuote | null;
  seconds?: number;
  onAccept: (quote: InsuranceQuote) => void;
  onDecline: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);
  const enter = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!quote) return;
    setRemaining(seconds);

    enter.setValue(0);
    bar.setValue(1);
    const slideIn = Animated.spring(enter, { toValue: 1, friction: 9, useNativeDriver: true });
    const drain = Animated.timing(bar, {
      toValue: 0,
      duration: seconds * 1_000,
      easing: Easing.linear,
      // Width, not scaleX, and therefore NOT on the native driver. scaleX would be cheaper but RN
      // has no transform-origin, so it drains from the centre outwards instead of from the right —
      // a progress bar that empties from both ends misreads as broken. One 4px bar on the JS
      // thread is a fair price for it draining the way a countdown should.
      useNativeDriver: false,
    });
    slideIn.start();
    drain.start();

    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          // Expiry declines. Doing nothing is the safe default: it costs the player a premium they
          // did not choose to pay, and leaves the hand exactly as it stood.
          onDecline();
          return 0;
        }
        return r - 1;
      });
    }, 1_000);

    return () => {
      clearInterval(id);
      slideIn.stop();
      drain.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, seconds]);

  if (!quote) return null;

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [120, 0] });

  return (
    <Animated.View style={[styles.wrap, { opacity: enter, transform: [{ translateY }] }]}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.shield}>◆</Text>
          <Text style={styles.title}>All-in insurance</Text>
          <Text style={styles.countdown}>{remaining}s</Text>
        </View>

        <View style={styles.figures}>
          <View>
            <Text style={styles.label}>ODDS</Text>
            <Text style={styles.odds}>{quote.payoutOdds.toFixed(2)}</Text>
          </View>
          <View style={styles.payoutCol}>
            <Text style={styles.label}>PAYOUT</Text>
            <Text style={styles.payout}>{chips(quote.coverage)}</Text>
          </View>
        </View>

        <View style={styles.track}>
          <Animated.View
            style={[
              styles.bar,
              { width: bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
            ]}
          />
        </View>

        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.ghost]} onPress={onDecline}>
            <Text style={styles.ghostText}>Decline</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.primary]} onPress={() => onAccept(quote)}>
            <Text style={styles.primaryText}>Insure for {chips(quote.premium)}</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    padding: space.lg,
  },
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.4)',
    backgroundColor: theme.surface,
    padding: space.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  shield: { color: theme.accent, fontSize: 15 },
  title: { color: theme.text, fontSize: 14, fontWeight: '700' },
  countdown: { marginLeft: 'auto', color: theme.dim, fontSize: 12 },
  figures: {
    marginTop: space.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.md,
  },
  label: { color: theme.dim, fontSize: 10, letterSpacing: 1 },
  odds: { color: theme.accent, fontSize: 26, fontWeight: '900' },
  payoutCol: { alignItems: 'flex-end' },
  payout: { color: theme.text, fontSize: 17, fontWeight: '700' },
  track: {
    marginTop: space.sm,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    overflow: 'hidden',
  },
  bar: { height: '100%', backgroundColor: theme.accent },
  actions: { marginTop: space.md, flexDirection: 'row', gap: space.sm },
  btn: { flex: 1, borderRadius: radius.card, paddingVertical: 12, alignItems: 'center' },
  ghost: { backgroundColor: theme.surface2 },
  ghostText: { color: theme.dim, fontSize: 13, fontWeight: '700' },
  primary: { backgroundColor: theme.brand },
  primaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
