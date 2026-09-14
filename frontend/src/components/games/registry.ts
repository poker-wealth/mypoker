import { DouDiZhuFelt } from './DouDiZhuFelt';
import { BaccaratFelt } from './BaccaratFelt';
import { NiuNiuFelt } from './NiuNiuFelt';
import { SanZhangFelt } from './SanZhangFelt';
import { RedPacketFelt } from './RedPacketFelt';
import { CowboyBeautyFelt } from './CowboyBeautyFelt';
import { LotteryFelt } from './LotteryFelt';
import { SlotsFelt } from './SlotsFelt';
import { TexasCowboyFelt } from './TexasCowboyFelt';
import type { TableCommand, TableSnapshot } from '@/lib/liveTable';

/**
 * Which screen each table gets.
 *
 * A table id missing from here falls through to the Hold'em felt, which is right for the poker
 * variants and wrong for everything else — so a new game's table id belongs here at the same time
 * as it goes into `LIVE_TABLE_IDS`.
 *
 * This lives in its own file rather than inside Table.tsx because it was lost to a merge twice:
 * main's copy of that page has no felts in it, so resolving a conflict in main's favour silently
 * sent every game back to the poker table — and nothing failed. The app built, every route loaded,
 * and baccarat dealt community cards. `registry.test.ts` now fails by name if the mapping goes.
 */
export type FeltComponent = (props: {
  snapshot?: TableSnapshot | null;
  onCommand?: (cmd: TableCommand) => void;
  /**
   * Taking a seat opens the buy-in sheet — it does NOT commit one.
   *
   * Every felt here used to send `{ kind: 'sit', buyIn: snapshot.minBuyIn }` straight from its
   * button, so one tap moved money at an amount the player was never shown and never chose. The
   * poker table has always gone through BuyInSheet; these nine did not. Mobile's audit found and
   * fixed the same thing in all eight of its felts, and the web — the Mini App — was left out.
   *
   * REQUIRED, not optional, and that is the fix as much as the call sites are: optional is what
   * made the old path reachable, and a required prop turns a felt that forgets it into a compile
   * error rather than a player spending money they did not agree to.
   */
  onSit: (seatIndex: number) => void;
}) => React.ReactElement;

export const GAME_FELTS: Record<string, FeltComponent> = {
  baccarat: BaccaratFelt,
  'niu-niu': NiuNiuFelt,
  'san-zhang': SanZhangFelt,
  'red-packet': RedPacketFelt,
  'cowboy-beauty': CowboyBeautyFelt,
  'dou-di-zhu': DouDiZhuFelt,
  lottery: LotteryFelt,
  slots: SlotsFelt,
  'texas-cowboy': TexasCowboyFelt,
};

/**
 * The screen for a table id. A practice table (`<game>-ai`) is the same game, so it gets the same
 * felt — and the poker family has no entry at all, which is how it falls through to the Hold'em
 * table.
 */
export function feltFor(tableId: string): FeltComponent | undefined {
  return GAME_FELTS[tableId] ?? GAME_FELTS[tableId.replace(/-ai$/, '')];
}
