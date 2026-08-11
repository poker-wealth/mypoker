import { registerRoom, type LiveRoom, type LiveTableConfig, type RoomDeps } from './live-room';
import { PokerRoom, type PokerRoomConfig } from './poker-room';

/**
 * Wires each game id to its live-room implementation.
 *
 * Imported for its side effects by `TableHub`, so merely using the hub registers every game. The
 * three poker variants share `PokerRoom` (the variant is carried on the config). To make a new game
 * reachable, build its room (satisfying `LiveRoom`) and register it here — that is the whole
 * integration; the hub, transport and settlement rail need no change.
 *
 *   Dev B — add your game below:
 *     registerRoom('baccarat', (config, deps) => new BaccaratRoom(config as BaccaratRoomConfig, deps));
 */

const pokerRoom = (config: LiveTableConfig, deps: RoomDeps): LiveRoom =>
  new PokerRoom(config as PokerRoomConfig, deps);

registerRoom('texas', pokerRoom);
registerRoom('short-deck', pokerRoom);
registerRoom('omaha', pokerRoom);
