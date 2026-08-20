import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

/**
 * Chips travelling between a seat and the pot.
 *
 * Ported from `frontend/src/components/poker/ChipsToPot.tsx` and `PotToWinner.tsx`, which are the
 * same movement in opposite directions — bets collected inward at the end of a street, the pot
 * pushed outward to whoever won it.
 *
 * It is decoration over an outcome the server already decided. It never moves a number: by the
 * time chips slide, the snapshot has already changed. Skipping the animation costs a player
 * nothing but the flourish, which is why nothing here blocks or delays a state update.
 *
 * The web uses `motion/react`; React Native's own `Animated` does the same job with `useNativeDriver`
 * so the movement runs off the JS thread and survives a busy render.
 */

export interface ChipTravelProps {
  /** Where the chips start and end, in points relative to the table. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Redraw and replay whenever this changes — a hand number, or a street. */
  travelKey: string | number;
  onDone?: () => void;
  color?: string;
}

const DURATION_MS = 420;

export function ChipTravel({ from, to, travelKey, onDone, color = '#f5c451' }: ChipTravelProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) onDone?.();
    });
    return () => anim.stop();
    // `travelKey` is the trigger; the coordinates are read at the start of each run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travelKey]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [from.x, to.x] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [from.y, to.y] });
  // Fade at the very end, so chips arrive rather than vanishing mid-flight.
  const opacity = progress.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.chip, { backgroundColor: color, opacity, transform: [{ translateX }, { translateY }] }]}
    >
      <View style={styles.inner} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
});
