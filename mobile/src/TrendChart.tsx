import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop, Line } from 'react-native-svg';
import { space, theme } from './theme';

/**
 * The cumulative profit line, ported from the Mini App's `TrendChart`.
 *
 * The web draws this with Chart.js onto a canvas, which React Native does not
 * have — so this is a re-implementation in SVG rather than a port. What it
 * keeps is the thing that makes the chart readable: the line and its fill
 * change colour exactly at the zero line, so "up" and "down" are legible
 * without reading the axis. Chart.js does that with a canvas gradient whose
 * stop sits at the zero pixel; the same trick works with an SVG gradient stop.
 *
 * Colours come straight from the theme here. The web version has to read CSS
 * variables off :root because canvas cannot resolve them — a wrinkle that
 * simply does not exist on this side.
 *
 * Renders NOTHING for fewer than two points. One round is not a trend, and a
 * single dot on an empty axis reads as a chart that failed to load.
 */

export interface TrendPoint {
  /** Signed net for the round, in the same unit the caller displays. */
  net: number;
  /** Epoch ms or ISO string. */
  at: number | string;
}

const HEIGHT = 140;
const PAD = 8;

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent): void => setWidth(e.nativeEvent.layout.width);

  // Oldest first, accumulating — the chart is about the running total, not
  // each hand in isolation.
  const ordered = [...points].reverse();
  const values: number[] = [];
  let running = 0;
  for (const p of ordered) {
    running += Number(p.net) || 0;
    values.push(running);
  }

  if (values.length < 2 || width === 0) {
    // Still measuring, or not enough to draw. An empty box beats a misleading one.
    return <View style={styles.box} onLayout={onLayout} />;
  }

  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  // A flat line at zero would divide by zero; give it a nominal range so it
  // renders along the middle instead of vanishing.
  const range = max - min || 1;

  const x = (i: number): number => PAD + (i / (values.length - 1)) * (width - PAD * 2);
  const y = (v: number): number => PAD + (1 - (v - min) / range) * (HEIGHT - PAD * 2);

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
  const area = `${line} L${x(values.length - 1)},${y(min)} L${x(0)},${y(min)} Z`;

  // Where zero sits, as a 0..1 fraction down the plot — the gradient's hinge.
  const zeroStop = Math.min(1, Math.max(0, (y(0) - PAD) / (HEIGHT - PAD * 2)));
  const last = values[values.length - 1]!;
  const endColor = last >= 0 ? theme.success : theme.danger;

  // Two stops at almost the same offset make the colour switch hard rather
  // than fade — a soft blend would imply values between winning and losing.
  const HAIR = 0.0001;

  return (
    <View style={styles.box} onLayout={onLayout}>
      <Svg width={width} height={HEIGHT}>
        <Defs>
          <LinearGradient id="stroke" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.success} />
            <Stop offset={zeroStop} stopColor={theme.success} />
            <Stop offset={Math.min(1, zeroStop + HAIR)} stopColor={theme.danger} />
            <Stop offset="1" stopColor={theme.danger} />
          </LinearGradient>
          <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.success} stopOpacity={0.35} />
            <Stop offset={zeroStop} stopColor={theme.success} stopOpacity={0} />
            <Stop offset={Math.min(1, zeroStop + HAIR)} stopColor={theme.danger} stopOpacity={0} />
            <Stop offset="1" stopColor={theme.danger} stopOpacity={0.35} />
          </LinearGradient>
        </Defs>

        {/* The break-even line. Without it, a chart entirely below zero looks
            identical to one entirely above. */}
        <Line x1={PAD} y1={y(0)} x2={width - PAD} y2={y(0)} stroke={theme.border} strokeWidth={1} />

        <Path d={area} fill="url(#fill)" />
        <Path d={line} stroke="url(#stroke)" strokeWidth={2} fill="none" />

        {/* The endpoint is the number the card is actually about. */}
        <Circle cx={x(values.length - 1)} cy={y(last)} r={3.5} fill={endColor} />
      </Svg>

      <Text style={[styles.endLabel, { color: endColor }]}>
        {(last >= 0 ? '+' : '') +
          last.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: HEIGHT, justifyContent: 'center' },
  endLabel: {
    position: 'absolute',
    right: space.xs,
    top: 0,
    fontSize: 11,
    fontWeight: '800',
  },
});
