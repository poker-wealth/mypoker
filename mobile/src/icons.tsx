import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * Tab bar icons.
 *
 * Hand-drawn rather than pulled from an icon set: five glyphs do not justify a
 * font dependency, and `react-native-svg` is already here for TrendChart.
 * The <100MB store budget is the other half of that reasoning — an icon font
 * ships every glyph whether or not it is used.
 *
 * Each takes `color` so React Navigation's active/inactive tint drives them.
 * Without an icon the tab bar draws its own placeholder, which renders as an
 * empty box — what the app was doing until now.
 */

export interface IconProps {
  color: string;
  size?: number;
}

const SW = 1.8; // one stroke weight for all five, so they read as a set

function Frame({ color, size = 24, children }: IconProps & { children: ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

/** Wallet — a billfold with a clasp. */
export function WalletIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <Rect x={2.5} y={5.5} width={19} height={13} rx={2.5} />
      <Path d="M2.5 9.5h19" />
      <Circle cx={17} cy={14} r={1.2} fill={p.color} stroke="none" />
    </Frame>
  );
}

/** Tables — a felt seen from above, with seats around it. */
export function TablesIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <Rect x={3} y={7} width={18} height={10} rx={5} />
      <Circle cx={8} cy={4.6} r={1.1} fill={p.color} stroke="none" />
      <Circle cx={16} cy={4.6} r={1.1} fill={p.color} stroke="none" />
      <Circle cx={8} cy={19.4} r={1.1} fill={p.color} stroke="none" />
      <Circle cx={16} cy={19.4} r={1.1} fill={p.color} stroke="none" />
    </Frame>
  );
}

/** Alliance — two figures, the smaller behind. */
export function AllianceIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <Circle cx={9} cy={8} r={3.2} />
      <Path d="M2.8 19.5c0-3.2 2.8-5.3 6.2-5.3s6.2 2.1 6.2 5.3" />
      <Path d="M16 5.4a3.2 3.2 0 0 1 0 6" />
      <Path d="M17.6 14.6c2.2.6 3.6 2.4 3.6 4.9" />
    </Frame>
  );
}

/** Data — three bars, ascending. */
export function DataIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <Path d="M4 20V13" />
      <Path d="M12 20V7" />
      <Path d="M20 20V10" />
      <Path d="M2.5 20h19" />
    </Frame>
  );
}

/** Account — one figure. */
export function AccountIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <Circle cx={12} cy={8} r={3.6} />
      <Path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </Frame>
  );
}
