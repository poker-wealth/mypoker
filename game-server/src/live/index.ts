/**
 * Live tables — real people, real seats, one authoritative hand.
 *
 * `PokerRoom` runs a table; `TableHub` puts the secure WebSocket in front of it; `players` and
 * `chip-bank` are the two swappable seams to identity and money.
 */
export { PokerRoom, DEFAULT_ROOM, RoomError } from './poker-room';
export type { PokerRoomConfig, PokerRoomDeps, SnapshotSender } from './poker-room';
export { TableHub } from './table-hub';
export type { TokenVerifier } from './table-hub';
export { createTableServer, startFromEnv, defaultTables } from './server';
export type { TableServer, TableServerConfig } from './server';
export { ChipBank } from './chip-bank';
export { DevPlayers, PlayerError } from './players';
export type { ChipLedger, PlayerDirectory, TablePlayer, DevPlayersOptions } from './players';
export { tableCommandSchema, betActionSchema } from './room-state';
export type {
  BetAction,
  FairnessSnapshot,
  RoomPhase,
  SeatSnapshot,
  SeatStatus,
  TableCommand,
  TableSnapshot,
  TableSummary,
} from './room-state';
