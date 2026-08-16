import { registerRoom, type LiveRoom, type LiveTableConfig, type RoomDeps } from './live-room';
import { PokerRoom, type PokerRoomConfig } from './poker-room';
import { BaccaratRoom, type BaccaratRoomConfig } from './baccarat-room';
import { NiuNiuRoom, type NiuNiuRoomConfig } from './niu-niu-room';
import { SanZhangRoom, type SanZhangRoomConfig } from './san-zhang-room';
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
registerRoom('red-packet', (config, deps) => new RedPacketRoom(config as RedPacketRoomConfig, deps));
registerRoom('cowboy-beauty', (config, deps) => new CowboyBeautyRoom(config as CowboyBeautyRoomConfig, deps));
registerRoom('dou-di-zhu', (config, deps) => new DouDiZhuRoom(config as DouDiZhuRoomConfig, deps));
registerRoom('lottery', (config, deps) => new LotteryRoom(config as LotteryRoomConfig, deps));
registerRoom('slots', (config, deps) => new SlotsRoom(config as SlotsRoomConfig, deps));
registerRoom('texas-cowboy', (config, deps) => new TexasCowboyRoom(config as TexasCowboyRoomConfig, deps));
