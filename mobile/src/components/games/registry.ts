import type { TableCommand, TableSnapshot } from '../../lib/liveTable';
import { HoldemFelt } from '../../screens/TableScreen';

/**
 * Which screen each table gets.
 *
 * The same registry `frontend/src/components/games/registry.ts` holds, and it lives in its own file
 * for the same reason: on web this mapping was lost to a merge twice, and because a missing entry
 * fell through to a default, every game silently rendered the poker table with nothing failing.
 * Here a missing entry renders nothing at all and the lobby will not open the table — a game
 * without a felt should be visibly absent, never quietly wrong.
 *
 * Ported so far: the poker family. The rest follow one at a time, each proved on device before the
 * next is started.
 */
export type FeltComponent = (props: {
  snapshot: TableSnapshot;
  onCommand: (cmd: TableCommand) => void;
}) => React.ReactElement;

/** Every table id that has a felt. Keep `PORTED_TABLES` in config.ts in step with this. */
export const GAME_FELTS: Record<string, FeltComponent> = {
  texas: HoldemFelt,
  'texas-high': HoldemFelt,
  'short-deck': HoldemFelt,
  omaha: HoldemFelt,
};

/** The felt for a table id, or undefined when it has none yet. */
export function feltFor(tableId: string): FeltComponent | undefined {
  return GAME_FELTS[tableId];
}
