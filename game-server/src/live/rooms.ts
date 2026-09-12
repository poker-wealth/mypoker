import { registerRoom, type LiveRoom, type LiveTableConfig, type RoomDeps } from './live-room';
import { PokerRoom, type PokerRoomConfig } from './poker-room';
import { BaccaratRoom, type BaccaratRoomConfig } from './baccarat-room';
import { NiuNiuRoom, type NiuNiuRoomConfig } from './niu-niu-room';
import { SanZhangRoom, type SanZhangRoomConfig } from './san-zhang-room';
import { RedEnvelopeRoom, type RedEnvelopeRoomConfig } from './red-envelope-room';
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
 * RED PACKET MINESWEEPER IS THE GRAB GAME NOW (`RedEnvelopeRoom`), not the grid
 * (`RedPacketRoom`). Both are called 红包扫雷; the reference app runs the grab
 * one — a banker lays an envelope, everyone taps for a packet, and the mine is
 * the last digit of what you got — and that is the one Victor asked for on
 * 12 Sep 2026.
 *
 * `RedPacketRoom` and its grid engine are LEFT IN PLACE, unregistered. They are
 * a complete, money-safe game with its own tests; deleting them is a decision
 * about the product, not a tidy-up, and un-deleting a game is much harder than
 * un-registering one. Nothing routes to it while this line stands.
 */
registerRoom('red-packet', (config, deps) => new RedEnvelopeRoom(config as RedEnvelopeRoomConfig, deps));
registerRoom('cowboy-beauty', (config, deps) => new CowboyBeautyRoom(config as CowboyBeautyRoomConfig, deps));
registerRoom('dou-di-zhu', (config, deps) => new DouDiZhuRoom(config as DouDiZhuRoomConfig, deps));
registerRoom('lottery', (config, deps) => new LotteryRoom(config as LotteryRoomConfig, deps));
registerRoom('slots', (config, deps) => new SlotsRoom(config as SlotsRoomConfig, deps));
registerRoom('texas-cowboy', (config, deps) => new TexasCowboyRoom(config as TexasCowboyRoomConfig, deps));
