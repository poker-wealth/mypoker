import { registerRoom, type LiveRoom, type LiveTableConfig, type RoomDeps } from './live-room';
import { PokerRoom, type PokerRoomConfig } from './poker-room';
import { BaccaratRoom, type BaccaratRoomConfig } from './baccarat-room';
import { NiuNiuRoom, type NiuNiuRoomConfig } from './niu-niu-room';
import { SanZhangRoom, type SanZhangRoomConfig } from './san-zhang-room';
import { RedEnvelopeRoom, type RedEnvelopeRoomConfig } from './red-envelope-room';
import { RedPacketRoom, type RedPacketRoomConfig } from './red-packet-room';
import { CowboyBeautyRoom, type CowboyBeautyRoomConfig } from './cowboy-beauty-room';
import { DouDiZhuRoom, type DouDiZhuRoomConfig } from './dou-di-zhu-room';
import { LotteryRoom, type LotteryRoomConfig } from './lottery-room';
import { SlotsRoom, type SlotsRoomConfig } from './slots-room';
import { TexasCowboyRoom, type TexasCowboyRoomConfig } from './texas-cowboy-room';

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
registerRoom('baccarat', (config, deps) => new BaccaratRoom(config as BaccaratRoomConfig, deps));
registerRoom('niu-niu', (config, deps) => new NiuNiuRoom(config as NiuNiuRoomConfig, deps));
registerRoom('san-zhang', (config, deps) => new SanZhangRoom(config as SanZhangRoomConfig, deps));
/*
 * RED PACKET MINESWEEPER IS THE GRAB GAME for any table created from now on
 * (`RedEnvelopeRoom`) — a banker lays an envelope, everyone taps for a packet,
 * and the mine is the last digit of what you got. That is the game Victor asked
 * for on 12 Sep 2026, and the one the reference app runs.
 *
 * `RedPacketRoom`, the grid version, is STILL REGISTERED and still reachable —
 * see the dispatch below. Tables already in the database were created by it and
 * keep playing it.
 */
registerRoom('red-packet', (config, deps) => {
  /*
   * WHICH RED PACKET IS THIS TABLE? Decided by the config it was STORED with,
   * not by which game we would build today.
   *
   * This took production down on 14 Sep 2026. The grab room was registered for
   * every `red-packet` table, and the tables already in the database were
   * created by the GRID game — they carry `size` and `mineCount` and have no
   * `totalAmount`. The grab room's constructor requires one, threw at startup,
   * and because rooms are built when the gateway boots, one unconvertible table
   * killed the entire gateway: every game, every table, down.
   *
   *   gateway failed to start — database: table red-packet (red-packet):
   *   totalAmount must be a number, got undefined
   *
   * Two lessons are baked in here rather than written on a wall:
   *
   *   A ROOM CANNOT ASSUME ITS OWN CONFIG SHAPE. Tables outlive deploys. Any
   *   game whose settings change has to read what is actually stored.
   *
   *   NO DEFAULTS. It would be one line to default `totalAmount` and boot
   *   cleanly — and it would invent the banker's maximum loss, on a live money
   *   table, from nothing. A table created as a grid is a grid; it keeps
   *   playing the game its players sat down to.
   *
   * New tables carry `totalAmount` and get the grab game. Old ones keep the
   * grid until they are closed and recreated.
   */
  const stored = config as Partial<RedEnvelopeRoomConfig>;
  return typeof stored.totalAmount === 'number'
    ? new RedEnvelopeRoom(config as RedEnvelopeRoomConfig, deps)
    : new RedPacketRoom(config as RedPacketRoomConfig, deps);
});
registerRoom('cowboy-beauty', (config, deps) => new CowboyBeautyRoom(config as CowboyBeautyRoomConfig, deps));
registerRoom('dou-di-zhu', (config, deps) => new DouDiZhuRoom(config as DouDiZhuRoomConfig, deps));
registerRoom('lottery', (config, deps) => new LotteryRoom(config as LotteryRoomConfig, deps));
registerRoom('slots', (config, deps) => new SlotsRoom(config as SlotsRoomConfig, deps));
registerRoom('texas-cowboy', (config, deps) => new TexasCowboyRoom(config as TexasCowboyRoomConfig, deps));
