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

/** Games — a controller, matching the web's Gamepad2 tab icon. */
export function GamesIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <Path d="M7.5 9.5v4M5.5 11.5h4" />
      <Circle cx={16} cy={11} r={1} fill={p.color} stroke="none" />
      <Circle cx={18.4} cy={13.4} r={1} fill={p.color} stroke="none" />
      <Path d="M8.2 6.5h7.6a5 5 0 0 1 4.9 4l.9 5.2a2.6 2.6 0 0 1-4.7 1.9l-1.2-1.8H8.3l-1.2 1.8a2.6 2.6 0 0 1-4.7-1.9l.9-5.2a5 5 0 0 1 4.9-4Z" />
    </Frame>
  );
}

/** Notifications — the header bell, matching the web's Bell. */
export function BellIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <Path d="M18 8.5a6 6 0 1 0-12 0c0 5-2.2 6.5-2.2 6.5h16.4S18 13.5 18 8.5Z" />
      <Path d="M13.7 19a2 2 0 0 1-3.4 0" />
    </Frame>
  );
}

/** Settings — the header gear on Data and Account. */
export function GearIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <Circle cx={12} cy={12} r={3} />
      <Path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </Frame>
  );
}

/** The lobby's "fair & secure" shield. */
export function ShieldIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <Path d="M12 2.8 5 5.6v5.2c0 4.3 3 8.3 7 9.4 4-1.1 7-5.1 7-9.4V5.6Z" />
      <Path d="m9.2 11.8 2 2 3.6-3.8" />
    </Frame>
  );
}

/** Alliance's help affordance. */
export function HelpIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4" />
      <Circle cx={12} cy={17} r={0.9} fill={p.color} stroke="none" />
    </Frame>
  );
}

/**
 * Chat — a speech square, matching the Mini App's `MessageSquare`.
 *
 * Used by the table's floating chat button. Drawn here with the others rather than pulled from an
 * icon set, for the same reason as the rest: five glyphs do not justify a font, and the <100MB
 * store budget counts every one that ships unused.
 */
export function ChatIcon(p: IconProps) {
  return (
    <Frame {...p}>
      <Path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3.6-.7L3 21l1.9-5A8.2 8.2 0 0 1 4 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8 8.4Z" />
    </Frame>
  );
}
