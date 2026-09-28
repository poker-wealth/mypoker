import { randomUUID } from 'node:crypto';
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

/**
 * The vendor float this room tries to keep the vendor account holding. Chosen so a full-cap payout
 * (maxPayoutMultiple × a table-sized wager) can be paid without the vendor going into overdraft.
 */
const VENDOR_FLOAT = 10_000;

/** A round may never pay more than wager × this. Shared with the exposure cap below it funds. */
const MAX_PAYOUT_MULTIPLE = 100;

export class SlotsRoom extends BaseLiveRoom<SlotsRoomConfig, RoomSeat> {
  private readonly adapter: ThirdPartyAdapter;
  /** Kept so the jackpot can draw on the seed a spin was actually generated from. */
  private readonly provider: SlotsProvider;
  private readonly vendorId: string;
  /**
   * Whether the vendor account's float actually funded at least once. Against the real FC the
   * vendor PLAYER account starts at 0, and a 409 from `buyIn` used to be swallowed silently — a
   * winning spin would then fail because the vendor could not pay it out, while a losing spin
   * settled into the vendor account as if nothing were wrong. Spins are refused until this is true.
   */
  private vendorFunded = false;
  /**
   * The vendor's locked chips as this room last knew them — what it can actually pay out. Drops by
   * a spin's net win, rises when `ensureVendorFunded` tops it back up. Checked before every spin so
   * a payout the vendor cannot cover is refused up front rather than failing at FC after the
   * provider has already produced a signed win.
   */
  private vendorFloat = 0;
  /** Single-flight guard: at most one funding attempt (initial or top-up) in the air at a time. */
  private funding: Promise<void> | null = null;

  constructor(config: SlotsRoomConfig, deps: RoomDeps) {
    super(config, deps);
    this.requireNumbers('commissionBps');

    this.vendorId = `acc-slots-vendor:${config.id}`;
    this.directory.ensure?.(this.vendorId, { displayName: 'Slots Vendor' });
    (this.directory as any).topUp?.(this.vendorId, 100_000);
    // Fire-and-forget at boot so the room does not block startup on FC being reachable — but a
    // failure here used to be the end of it (vendorFunded stayed false forever, even once FC came
    // back). `ensureVendorFunded` resets its single-flight lock on rejection, so the first spin
    // after a failed boot attempt retries rather than finding a permanently unfunded room.
    void this.ensureVendorFunded().catch(() => {
      // Already logged inside ensureVendorFunded — this catch only stops an unhandled rejection.
    });

    const secret = config.secret ?? process.env.SLOTS_PROVIDER_SECRET ?? 'slots-live-secret';
    const provider = new SlotsProvider(secret);
    this.provider = provider;

    this.adapter = new ThirdPartyAdapter(this.fc, {
      provider,
      secret,
      providerAccountId: this.vendorId,
      maxPayoutMultiple: MAX_PAYOUT_MULTIPLE,
      commissionBps: config.commissionBps,
      tableType: 'PLATFORM',
      accountOf: (p) => p,
      jackpotAccounts: tableJackpotAccounts(config.id),
    });
  }

  /**
   * Make sure the vendor holds at least `VENDOR_FLOAT` in locked chips, topping up rather than
   * locking a fresh float every time: an unconditional `buyIn(VENDOR_FLOAT)` on every boot or retry
   * only ever grows what is locked, and nothing ever releases it, so eventually the vendor's
   * available balance runs out and every future boot 409s forever.
   *
   * Single-flight: concurrent callers (boot + an early spin) share the one funding attempt in
   * flight. A rejection clears the lock so the very next call starts a fresh attempt — that is the
   * retry. Once funded, a call is a no-op UNLESS `vendorFloat` has since dropped below the float
   * (a win paid out since the last top-up), in which case it tops back up.
   */
  private ensureVendorFunded(): Promise<void> {
    if (this.vendorFunded && this.vendorFloat >= VENDOR_FLOAT) return Promise.resolve();
    if (!this.funding) {
      this.funding = this.fundVendor()
        .then(() => {
          this.funding = null;
        })
        .catch((err) => {
          this.funding = null;
          console.error(`[room ${this.config.id}] slots vendor float not funded — spins refused:`, err);
          throw err;
        });
    }
    return this.funding;
  }

  private async fundVendor(): Promise<void> {
    if (this.fc.lockedBalance) {
      const locked = Number(await this.fc.lockedBalance(this.vendorId));
      const need = VENDOR_FLOAT - locked;
      if (need > 0) {
        await this.fc.buyIn(this.vendorId, String(need));
      }
      this.vendorFloat = Math.max(locked, VENDOR_FLOAT);
      this.vendorFunded = true;
      return;
    }

    // The inner client cannot answer "how much is actually locked" at all — that is UNKNOWN, never
    // zero (BUG-10 follow-up B: `ChipDenominatedFc.lockedBalance` used to report '0' here, which
    // made this buy the full float on every top-up on top of whatever was already locked). With no
    // ground truth to read, fall back to this room's own tracking: buy the whole float on the very
    // first funding (nothing can be locked yet), or just the shortfall against what this room has
    // tracked locally on a later top-up.
    if (!this.vendorFunded) {
      await this.fc.buyIn(this.vendorId, String(VENDOR_FLOAT));
      this.vendorFloat = VENDOR_FLOAT;
    } else {
      const need = VENDOR_FLOAT - this.vendorFloat;
      if (need > 0) {
        await this.fc.buyIn(this.vendorId, String(need));
        this.vendorFloat += need;
      }
    }
    this.vendorFunded = true;
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
    try {
      await this.ensureVendorFunded();
    } catch {
      throw new RoomError('slots are unavailable — vendor float not funded');
    }
    const seat = this.seatOf(playerId);
    if (!seat) throw new RoomError('not seated');

    const wager = action.amount ?? 100;
    if (wager <= 0 || wager > seat.stack) throw new RoomError('invalid wager amount');

    // The vendor's worst case on this spin is wager × (MAX_PAYOUT_MULTIPLE − 1) net (payout capped
    // at wager × MAX_PAYOUT_MULTIPLE, minus the wager itself). Refuse up front rather than letting
    // the provider produce a signed win the vendor cannot actually pay — that used to fail at
    // settlement, after the round was already decided.
    const worstCaseNet = wager * (MAX_PAYOUT_MULTIPLE - 1);
    if (worstCaseNet > this.vendorFloat) {
      const maxStake = Math.floor(this.vendorFloat / (MAX_PAYOUT_MULTIPLE - 1));
      throw new RoomError(`wager too large for the vendor float — max stake is ${maxStake} chips`);
    }

    this.handNumber++;
    // The suffix is not cosmetic: FC treats a repeated roundId as a settlement replay (idempotency
    // key) and returns applied:false without moving money. handNumber alone repeats across room
    // instances sharing a config.id, so a random component is load-bearing here.
    const roundId = `${this.config.id}-spin-${this.handNumber}-${randomUUID().slice(0, 8)}`;

    const receipt = await this.adapter.play(playerId, roundId, wager);
    // `receipt.providerDelta`, NOT `-receipt.net` (BUG-10 follow-up A): on a player LOSS the vendor
    // is the WINNER in the adapter's settlement, so rake + the jackpot injection come off the
    // vendor's own credit first — crediting the full `|net|` here drifted the tracked float upward
    // forever, eventually admitting stakes the vendor's real locked balance could not pay. Tracked
    // locally so the next spin's cap check (above) and `ensureVendorFunded`'s top-up decision
    // (below) don't need a round trip to FC every time.
    this.vendorFloat += receipt.providerDelta;

    const outcome = receipt.outcome as { reels?: string[] } | undefined;
    seat.reels = outcome?.reels;
    seat.bet = wager;
    seat.net = receipt.net;
    seat.stack += receipt.net;

    if (receipt.net > 0) {
      // The jackpot draws on the seed the spin itself came from — HMAC(sessionSeed, roundId),
      // the same value the reels are derived from. It used to draw on a seed built from the
      // round id, which any player can reproduce, so a jackpot was predictable before it fired.
      await this.processJackpot(receipt.net, roundId, this.provider.roundSeed(roundId));
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
