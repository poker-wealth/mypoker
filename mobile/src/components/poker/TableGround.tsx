import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { designById, groundFor } from '../../table/tableDesigns';
import { useTableDesign } from '../../table/tableDesignStore';

/**
 * The table's ground — the whole screen, behind everything.
 *
 * A REAL RADIAL GRADIENT, via react-native-svg. The obvious approximation was
 * `expo-linear-gradient`, which cannot do radial at all: a vertical fade reads
 * as a horizon rather than a pool of light, and the Mini App's ground is
 * unmistakably radial. Since the two clients are one product, "close enough on
 * the phone" would have been a visible difference a player could point at.
 *
 * Percentage-based (`r="70%"`, centred at 50%/38%) so it fills whatever it is
 * given without the caller measuring anything.
 *
 * Absolutely positioned and `pointerEvents="none"`: it is a backdrop, and must
 * never intercept a tap meant for a seat.
 */
export function TableGround() {
  const { id } = useTableDesign();
  const [inner, mid, outer] = groundFor(designById(id));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          {/* Centre sits ABOVE the middle, as on the web — a pool of light in
              the upper third rather than a bullseye. */}
          <RadialGradient id="ground" cx="50%" cy="38%" r="70%">
            <Stop offset="0%" stopColor={inner} />
            <Stop offset="45%" stopColor={mid} />
            <Stop offset="100%" stopColor={outer} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ground)" />
      </Svg>
    </View>
  );
}
