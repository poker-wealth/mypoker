import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text } from 'react-native';
import { chips } from '../../lib/money';
import { radius, theme } from '../../theme';
import type { SeatPos } from '../../table/tableDesigns';

/**
 * The pot travelling from the middle to whoever won it.
 *
 * Ported from `frontend/src/components/poker/PotToWinner.tsx`. The counterpart to ChipsToPot, and
 * the moment a hand actually resolves. A stack that simply increments tells a player they won;
 * watching the pot arrive tells them how much and from where — and at a table with side pots, WHICH
 * pot came to them.
 *
 * Decorative and derived: the ledger settled before any of this rendered. If the component never
 * mounts, the chips are still exactly right.
 *
 * Deliberately silent when there is no showdown — a hand everyone folds out of has a winner but no
 * drama worth staging, and animating it every time would make the celebration mean nothing when it
 * matters.
 *
 * Positioning follows the rest of the table rather than the web original: `SeatPos` here carries
 * PERCENTAGES as numbers, and the parent already knows the table's pixel size, so it passes that in
 * and this converts. The web version can hand CSS `left: '42%'` straight to the DOM; React Native
 * would read that number as 42 pixels, which is silently wrong rather than broken — the worst kind.
 */
export function PotToWinner({
  handId,
  amount,
  winners,
  tableWidth,
  tableHeight,
  /** Where the pot sits, as a percentage of the table. Matches the web original's 50% / 44%. */
  potLeft = 50,
  potTop = 44,
}: {
  /** Changing this is what arms the next celebration. */
  handId: string | number | null;
  /** The pot as it stood before it was awarded. */
  amount: number;
  /** Where each winning seat sits. Split pots animate to each of them. */
  winners: SeatPos[];
  tableWidth: number;
  tableHeight: number;
  potLeft?: number;
  potTop?: number;
}) {
  const [showing, setShowing] = useState<SeatPos[]>([]);
  const lastHand = useRef(handId);
  /**
   * Web reads `prefers-reduced-motion` synchronously; on RN it is an async query, so this starts
   * false and corrects itself. Worst case one celebration plays before the setting is known — the
   * alternative, suppressing the first one for everybody, is worse for the majority who did not ask
   * for reduced motion.
   */
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (!cancelled) setReduced(on);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    // Arm on the hand ENDING, not on a winner appearing: `isWinner` can flicker true mid-hand on
    // some feeds, and a celebration that fires early spoils the showdown it is meant to punctuate.
    if (handId === lastHand.current) return;
    lastHand.current = handId;
    if (reduced || winners.length === 0 || amount <= 0) return;

    setShowing(winners);
    const id = setTimeout(() => setShowing([]), 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handId, reduced]);

  // Split pots divide the visible amount so the numbers add up to the pot — showing each winner the
  // full pot would misreport what they received.
  const share = showing.length > 0 ? Math.floor(amount / showing.length) : 0;

  return (
    <>
      {showing.map((seat, i) => (
        <Flight
          key={`${seat.left}-${seat.top}-${i}`}
          share={share}
          fromX={(potLeft / 100) * tableWidth}
          fromY={(potTop / 100) * tableHeight}
          toX={(seat.left / 100) * tableWidth}
          toY={(seat.top / 100) * tableHeight}
        />
      ))}
    </>
  );
}

/** One award, travelling from the pot to its seat. */
function Flight({
  share,
  fromX,
  fromY,
  toX,
  toY,
}: {
  share: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(t, {
      toValue: 1,
      duration: 850,
      easing: Easing.out(Easing.cubic),
      // Off the JS thread: anything that stutters during a showdown reads as the app hanging on
      // the one screen where money just moved.
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [t]);

  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [fromX, toX] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [fromY, toY] });
  const opacity = t.interpolate({ inputRange: [0, 0.25, 0.7, 1], outputRange: [0, 1, 1, 0] });
  const scale = t.interpolate({ inputRange: [0, 0.25, 0.7, 1], outputRange: [0.6, 1.15, 1, 0.9] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.badge, { opacity, transform: [{ translateX }, { translateY }, { scale }] }]}
    >
      <Text style={styles.text}>+{chips(share)}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 30,
    borderRadius: radius.pill,
    backgroundColor: theme.success,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: { color: '#fff', fontSize: 11, fontWeight: '900' },
});
