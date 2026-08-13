import { SlotsProvider } from '../games/slots/slots-provider';
import { ThirdPartyAdapter } from '../games/third-party/adapter';
import { BaseLiveRoom, RoomError, tableJackpotAccounts, type BaseRoomSeat } from './base-room';
import type { LiveTableConfig, RoomDeps } from './live-room';
import type { TableSnapshot } from './room-state';

export interface SlotsRoomConfig extends LiveTableConfig {
  id: string;
  name: string;
  game: 'slots';
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  commissionBps: number;
  secret?: string;
}

interface RoomSeat extends BaseRoomSeat {
  reels?: string[] | undefined;
}

export class SlotsRoom extends BaseLiveRoom<SlotsRoomConfig, RoomSeat> {
  private readonly adapter: ThirdPartyAdapter;

  constructor(config: SlotsRoomConfig, deps: RoomDeps) {
    super(config, deps);

    const vendorId = `acc-slots-vendor:${config.id}`;
    this.directory.ensure?.(vendorId, { displayName: 'Slots Vendor' });
    (this.directory as any).topUp?.(vendorId, 100_000);
    void this.fc.buyIn(vendorId, '10000').catch(() => {});

    const secret = config.secret ?? process.env.SLOTS_PROVIDER_SECRET ?? 'slots-live-secret';
    const provider = new SlotsProvider(secret);

    this.adapter = new ThirdPartyAdapter(this.fc, {
      provider,
      secret,
      providerAccountId: vendorId,
      maxPayoutMultiple: 100,
      commissionBps: config.commissionBps,
      tableType: 'PLATFORM',
      accountOf: (p) => p,
      jackpotAccounts: tableJackpotAccounts(config.id),
    });
  }

  protected createSeatRecord(
    seatIndex: number,
    playerId: string,
    displayName: string,
    buyIn: number,
    avatarUrl?: string,
  ): RoomSeat {
    return {
      index: seatIndex,
      playerId,
      name: displayName,
      ...(avatarUrl ? { avatarUrl } : {}),
      stack: buyIn,
      bet: 0,
      connected: this.viewers.has(playerId),
    };
  }

  protected async handleAct(playerId: string, action: { type: string; amount?: number }): Promise<void> {
    const seat = this.seatOf(playerId);
    if (!seat) throw new RoomError('not seated');

    const wager = action.amount ?? 100;
    if (wager <= 0 || wager > seat.stack) throw new RoomError('invalid wager amount');

    this.handNumber++;
    const roundId = `${this.config.id}-spin-${this.handNumber}`;

    const receipt = await this.adapter.play(playerId, roundId, wager);

    const outcome = receipt.outcome as { reels?: string[] } | undefined;
    seat.reels = outcome?.reels;
    seat.bet = wager;
    seat.net = receipt.net;
    seat.stack += receipt.net;

    if (receipt.net > 0) {
      await this.processJackpot(receipt.net, roundId, `${roundId}:seed`);
    }

    this.phase = 'SHOWDOWN';
    this.push();
  }

  snapshotFor(playerId: string): TableSnapshot {
    const seat = this.seatOf(playerId);

    return {
      tableId: this.config.id,
      name: this.config.name,
      variant: 'Slots',
      smallBlind: 0,
      bigBlind: 0,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      maxSeats: this.config.maxSeats,
      phase: this.phase,
      handId: this.handNumber > 0 ? `#${this.handNumber}` : null,
      handNumber: this.handNumber,
      street: null,
      pot: 0,
      board: seat?.reels ?? [],
      seats: this.seats.map((s, idx) => {
        if (!s) {
          return {
            index: idx,
            playerId: '',
            name: '',
            stack: 0,
            bet: 0,
            status: 'sittingout',
            inHand: false,
            connected: false,
            isDealer: false,
            isWinner: false,
            isYou: false,
            cards: [],
          };
        }

        let lastAction: string | undefined;
        if (s.reels && s.reels.length > 0) lastAction = `${s.reels.join(' ')}`;

        return {
          index: s.index,
          playerId: s.playerId,
          name: s.name,
          ...(s.avatarUrl ? { avatarUrl: s.avatarUrl } : {}),
          stack: s.stack,
          bet: s.bet,
          status: 'active',
          inHand: true,
          connected: s.connected,
          isDealer: false,
          isWinner: (s.net ?? 0) > 0,
          isYou: s.playerId === playerId,
          cards: [],
          ...(lastAction ? { lastAction } : {}),
        };
      }),
      insurance: null,
      jackpot: this.lastJackpotWin,
      yourSeat: seat ? seat.index : null,
      you: seat ? { playerId: seat.playerId, name: seat.name, available: seat.stack } : null,
      toActSeat: null,
      actionDeadline: null,
      legal: null,
      winners: this.occupiedSeats().filter((s) => (s.net ?? 0) > 0).map((s) => s.index),
      serverTime: Date.now(),
    };
  }
}
