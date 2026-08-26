import type { TableCommand, TableSnapshot } from '../../lib/liveTable';
import { HoldemFelt } from './HoldemFelt';
import { NiuNiuFelt } from './NiuNiuFelt';
import { BaccaratFelt } from './BaccaratFelt';
import { SideBetFelt } from './SideBetFelt';
import { RedPacketFelt } from './RedPacketFelt';
import { DouDiZhuFelt } from './DouDiZhuFelt';
import { LotteryFelt } from './LotteryFelt';
import { SlotsFelt } from './SlotsFelt';
import { TexasCowboyFelt } from './TexasCowboyFelt';
import { theme } from '../../theme';

/**
 * Which screen each table gets.
 *
 * The same registry `frontend/src/components/games/registry.ts` holds, in its own file for the same
 * reason: on web this mapping was lost to a merge twice, and because a missing entry fell through
 * to a default, every game silently rendered the poker table with nothing failing. Here a missing
 * entry renders a plain "no felt yet" and the lobby will not open the table — a game without a felt
 * should be visibly absent, never quietly wrong.
 */
export type FeltComponent = (props: {
  snapshot: TableSnapshot;
  onCommand: (cmd: TableCommand) => void;
  /**
   * Taking a seat — opens the buy-in sheet, which the screen owns.
   *
   * REQUIRED, and it was optional until an audit found eight felts sending a sit command with
   * `buyIn: snapshot.minBuyIn` straight from a button — money moved at an amount the player was
   * never shown and never chose. Optional is what made that reachable; required turns it into a
   * compile error.
   */
  onSit: (seatIndex: number) => void;
}) => React.ReactElement;

/** Cowboy & Beauty: one card each, parimutuel odds that move as the pools fill. */
function CowboyBeautyFelt({ snapshot, onCommand, onSit }: Parameters<FeltComponent>[0]) {
  const round = snapshot.gameState as
    | {
        pools?: Record<string, number>;
        cowboyCard?: string | null;
        beautyCard?: string | null;
        winner?: string | null;
      }
    | undefined;

  return (
    <SideBetFelt
      snapshot={snapshot}
      onCommand={onCommand}
      onSit={onSit}
      title="COWBOY & BEAUTY"
      outcome={round?.winner ? `${round.winner} WINS` : null}
      reveal={[
        { label: 'COWBOY', cards: round?.cowboyCard ? [round.cowboyCard] : [] },
        { label: 'BEAUTY', cards: round?.beautyCard ? [round.beautyCard] : [] },
      ]}
      sides={[
        { id: 'cowboy', label: 'COWBOY', tone: theme.jackpot, pool: round?.pools?.COWBOY ?? 0 },
        { id: 'beauty', label: 'BEAUTY', tone: theme.danger, pool: round?.pools?.BEAUTY ?? 0 },
      ]}
    />
  );
}

/** San Zhang: three cards, player-banked, one stake against the bank. */
function SanZhangFelt({ snapshot, onCommand, onSit }: Parameters<FeltComponent>[0]) {
  return (
    <SideBetFelt
      snapshot={snapshot}
      onCommand={onCommand}
      onSit={onSit}
      title="SAN ZHANG"
      outcome={snapshot.phase === 'SHOWDOWN' ? (snapshot.message ?? null) : null}
      bankerCannotBet
      sides={[{ id: 'bet', label: 'STAKE AGAINST THE BANK', tone: theme.accent }]}
    />
  );
}

/**
 * Every table id that has a felt. This map is the single list — `scripts/check-felts.mjs` reads it
 * and fails the build if an id disappears.
 */
export const GAME_FELTS: Record<string, FeltComponent> = {
  texas: HoldemFelt,
  'texas-high': HoldemFelt,
  'short-deck': HoldemFelt,
  omaha: HoldemFelt,
  'niu-niu': NiuNiuFelt,
  baccarat: BaccaratFelt,
  'cowboy-beauty': CowboyBeautyFelt,
  'san-zhang': SanZhangFelt,
  'red-packet': RedPacketFelt,
  'dou-di-zhu': DouDiZhuFelt,
  lottery: LotteryFelt,
  slots: SlotsFelt,
  'texas-cowboy': TexasCowboyFelt,
};

/**
 * The felt for a table id, or undefined when it has none yet.
 *
 * A practice table (`<game>-ai`) is the same game, so it gets the same felt — the web registry does
 * the same, and without it every practice table would report having no felt at all.
 */
export function feltFor(tableId: string): FeltComponent | undefined {
  return GAME_FELTS[tableId] ?? GAME_FELTS[tableId.replace(/-ai$/, '')];
}
