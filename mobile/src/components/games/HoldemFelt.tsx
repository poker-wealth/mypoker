import { PokerTable } from '../poker/PokerTable';
import type { TableCommand, TableSnapshot } from '../../lib/liveTable';

/**
 * The poker family's felt — Texas, Texas High, Short Deck and Omaha share one screen.
 *
 * It lives here rather than in `TableScreen` because the registry imports it and `TableScreen`
 * imports the registry: as one file that was a require cycle, and Metro warns that a cycle "can
 * result in uninitialized values". An uninitialized value here means `GAME_FELTS.texas` is
 * `undefined` at module-eval time and every poker table reports having no felt. That is the same
 * silent-wrong failure the registry file exists to prevent, so the cycle gets broken rather than
 * tolerated.
 */
export function HoldemFelt({
  snapshot,
  onSit,
}: {
  snapshot: TableSnapshot;
  onCommand: (cmd: TableCommand) => void;
  onSit?: (seatIndex: number) => void;
}) {
  const seated = snapshot.seats.some((s) => s.isYou);
  // Sitting goes through the buy-in sheet, so the amount is chosen rather than assumed.
  return <PokerTable snapshot={snapshot} {...(seated || !onSit ? {} : { onSit })} />;
}
