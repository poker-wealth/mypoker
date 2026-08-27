import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { PlayingCard } from '../poker/PlayingCard';
import { designById, ringFor } from '../../table/tableDesigns';
import { radius, space, theme } from '../../theme';
import type { LiveSeat, TableCommand, TableSnapshot } from '../../lib/liveTable';

/**
 * NIU NIU (BULL BULL).
 *
 * Ported from `frontend/src/components/games/NiuNiuFelt.tsx`, on the same table artwork and the
 * same measured seat ring the Hold'em felt uses, so a design carries across every game.
 *
 * The round has two stages and the controls follow `snapshot.stage`:
 *   BIDDING  — bid 1x, 2x or 5x for the bank. The highest bid takes the chair, and that bid
 *              multiplies every settlement of the round.
 *   BETTING  — everyone else stakes against the banker at their own 1x / 2x / 5x.
 *
 * The server decides all of it. Nothing here computes a stack, a payout or a winner.
 */

/** Mirrors `NiuNiuRoundState` in game-server/src/live/niu-niu-room.ts. */
interface NiuNiuRoundState {
  bankerMultiplier: number;
  seats: Array<{ index: number; bid?: number; betMultiplier?: number; hand?: string; net?: number }>;
}

const CHIPS = [50, 100, 500, 1_000];
const BANK_BIDS = [1, 2, 5];
const STAKE_MULTIPLIERS = [1, 2, 5];

export function NiuNiuFelt({
  snapshot,
  onCommand,
  onSit,
}: {
  snapshot: TableSnapshot;
  onCommand: (cmd: TableCommand) => void;
  /**
   * Taking a seat opens the buy-in sheet — it does NOT commit one.
   *
   * Every one of these felts used to send { kind: 'sit', buyIn: snapshot.minBuyIn } straight
   * from the button, so a tap moved money at an amount the player was never shown and never
   * chose. The poker felt has always gone through BuyInSheet; the other eight did not. An audit
   * found all eight.
   *
   * Required, not optional: a felt that cannot open the sheet must not fall back to spending.
   */
  onSit: (seatIndex: number) => void;
}) {
  const { width } = useWindowDimensions();
  const [betAmount, setBetAmount] = useState(100);
  const [multiplier, setMultiplier] = useState(1);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const design = designById('emerald');
  const tableWidth = Math.min(width - 24, 440);
  const tableHeight = tableWidth / design.aspect;

  const phase = snapshot.phase;
  const stage = snapshot.stage;
  const round = snapshot.gameState as NiuNiuRoundState | undefined;
  const seats = snapshot.seats;
  const you = seats.find((s) => s.isYou);
  const youAreBanker = Boolean(you?.isDealer);

  const stateOf = (index: number) => round?.seats.find((s) => s.index === index);
  const youBid = you ? stateOf(you.index)?.bid : undefined;
  // The multiplier the SERVER recorded for this bet, not the one currently selected in the picker.
  // After a bet is placed the picker can still move; showing its value would restate a committed
  // bet with a number that no longer describes it.
  const youMultiplier = you ? stateOf(you.index)?.betMultiplier : undefined;

  const secondsLeft = snapshot.actionDeadline
    ? Math.max(0, Math.ceil((snapshot.actionDeadline - now) / 1_000))
    : null;

  const ring = ringFor(design, Math.max(2, seats.length));
  const yourPlace = you ? seats.findIndex((s) => s.index === you.index) : -1;
  const ordered = yourPlace > 0 ? [...seats.slice(yourPlace), ...seats.slice(0, yourPlace)] : seats;

  const sitDown = (): void => {
    const free = seats.find((s) => !s.playerId);
    onSit(free?.index ?? 0);
  };
  const bid = (n: number): void => onCommand({ kind: 'act', action: { type: `bid-${n}` } });
  const placeBet = (): void =>
    onCommand({ kind: 'act', action: { type: 'bet', amount: betAmount, multiplier } });

  const centreLabel =
    phase === 'SHOWDOWN'
      ? 'Showdown'
      : stage === 'BIDDING'
        ? 'Bidding for the bank'
        : stage === 'BETTING'
          ? 'Place your bets'
          : 'Waiting';

  return (
    <View style={styles.wrap}>
      <View style={[styles.stage, { width: tableWidth, height: tableHeight }]}>
        {design.art ? <Image source={design.art} style={styles.art} resizeMode="contain" /> : null}

        <View style={[styles.centre, { top: (design.boardTop / 100) * tableHeight }]} pointerEvents="none">
          {secondsLeft !== null && phase === 'IN_HAND' ? (
            <View style={[styles.clock, { borderColor: design.accent }]}>
              <Text style={[styles.clockText, { color: design.accent }]}>{secondsLeft}</Text>
            </View>
          ) : null}

          <Text style={styles.centreLabel}>{centreLabel}</Text>

          {round && round.bankerMultiplier > 1 ? (
            <Text style={[styles.bankPays, { color: design.accent }]}>
              BANK PAYS {round.bankerMultiplier}×
            </Text>
          ) : null}

          {phase === 'WAITING' && snapshot.message ? (
            <Text style={styles.waiting}>{snapshot.message}</Text>
          ) : null}
        </View>

        {ordered.map((seat, place) => {
          const slot = ring[place % ring.length]!;
          return (
            <View
              key={seat.index}
              style={[
                styles.seat,
                { left: (slot.left / 100) * tableWidth, top: (slot.top / 100) * tableHeight },
              ]}
            >
              <NiuSeat
                seat={seat}
                info={stateOf(seat.index)}
                bankMultiplier={round?.bankerMultiplier ?? 1}
                accent={design.accent}
              />
            </View>
          );
        })}
      </View>

      {/* Controls, under the table */}
      <View style={styles.controls}>
        {!you ? (
          <Pressable onPress={sitDown} style={styles.primary}>
            <Text style={styles.primaryText}>Sit to Play Niu Niu</Text>
          </Pressable>
        ) : stage === 'BIDDING' ? (
          <>
            <Text style={styles.hint}>
              {youBid === undefined
                ? 'Bid for the bank — the highest bid takes it, and multiplies the whole round'
                : `You bid ${youBid}× — waiting for the table`}
            </Text>
            <View style={styles.row}>
              {BANK_BIDS.map((n) => (
                <Pressable
                  key={n}
                  onPress={() => bid(n)}
                  style={[styles.pill, youBid === n && styles.pillOn]}
                >
                  <Text style={[styles.pillText, youBid === n && styles.pillTextOn]}>Bid {n}×</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : stage === 'BETTING' && !youAreBanker ? (
          <>
            <View style={styles.row}>
              {CHIPS.map((amt) => (
                <Pressable
                  key={amt}
                  onPress={() => setBetAmount(amt)}
                  style={[styles.chip, betAmount === amt && styles.chipOn]}
                >
                  <Text style={[styles.chipText, betAmount === amt && styles.chipTextOn]}>
                    {amt}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              {STAKE_MULTIPLIERS.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setMultiplier(m)}
                  style={[styles.pill, multiplier === m && styles.pillOn]}
                >
                  <Text style={[styles.pillText, multiplier === m && styles.pillTextOn]}>{m}×</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              disabled={(you?.bet ?? 0) > 0}
              onPress={placeBet}
              style={[styles.primary, (you?.bet ?? 0) > 0 && styles.primaryOff]}
            >
              {/*
                The stake is `betAmount`. It is NOT betAmount × multiplier.

                niu-niu-room.ts sets `seat.bet = amount` and stores `seat.betMultiplier`
                separately; the multiplier scales SETTLEMENT, not what leaves your stack when the
                bet is placed. This button used to read `Stake ₮500 (₮100 × 5)` and then, once
                placed, `Staked ₮100` — the same bet stated two different ways, overstating before
                and understating after. An audit called it "misstating the stake in both
                directions", which is exactly right.

                So: the amount committed, and the multiplier named as what it is — a multiplier on
                the outcome, not on the stake.
              */}
              <Text style={styles.primaryText}>
                {(you?.bet ?? 0) > 0
                  ? `Staked ₮${you?.bet}${youMultiplier ? ` · ${youMultiplier}× on the result` : ''}`
                  : `Stake ₮${betAmount} · ${multiplier}× on the result`}
              </Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.hint}>
            {youAreBanker
              ? 'You hold the bank — waiting on the bets'
              : (snapshot.message ?? 'Waiting for the next round')}
          </Text>
        )}
      </View>
    </View>
  );
}

/** One chair: their five cards, nameplate and stack, and what they are playing at. */
function NiuSeat({
  seat,
  info,
  bankMultiplier,
  accent,
}: {
  seat: LiveSeat;
  info: NiuNiuRoundState['seats'][number] | undefined;
  bankMultiplier: number;
  accent: string;
}) {
  if (!seat.playerId) return <View style={styles.emptySeat} />;

  const badge = seat.isDealer
    ? `${bankMultiplier}×`
    : info?.betMultiplier
      ? `${info.betMultiplier}×`
      : info?.bid
        ? `bid ${info.bid}×`
        : null;

  return (
    <View style={styles.seatInner}>
      {seat.cards.length > 0 && (
        <View style={styles.cards}>
          {seat.cards.map((c, i) => (
            <PlayingCard key={i} card={c} size="sm" />
          ))}
        </View>
      )}

      {info?.hand ? (
        <Text style={[styles.handName, { color: accent }]}>{info.hand}</Text>
      ) : null}

      <View style={[styles.plate, seat.isDealer && { borderColor: accent }]}>
        <Text style={styles.name} numberOfLines={1}>
          {seat.name}
        </Text>
        <Text style={styles.stack}>₮{seat.stack}</Text>
        {seat.isDealer ? (
          <Text style={[styles.banker, { color: accent }]}>👑 BANKER</Text>
        ) : null}
        {seat.bet > 0 ? <Text style={styles.bet}>bet ₮{seat.bet}</Text> : null}
        {info?.net !== undefined && info.net !== 0 ? (
          <Text style={[styles.net, { color: info.net > 0 ? theme.success : theme.danger }]}>
            {info.net > 0 ? '+' : ''}
            {info.net}
          </Text>
        ) : null}
      </View>

      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  stage: { alignSelf: 'center' },
  art: { position: 'absolute', width: '100%', height: '100%' },
  centre: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 4 },
  clock: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockText: { fontSize: 22, fontWeight: '900' },
  centreLabel: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  bankPays: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  waiting: { color: theme.dim, fontSize: 11, textAlign: 'center', paddingHorizontal: 20 },
  seat: { position: 'absolute', marginLeft: -37, marginTop: -34 },
  seatInner: { alignItems: 'center', gap: 2 },
  emptySeat: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.15)',
  },
  cards: { flexDirection: 'row', gap: 1 },
  handName: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  plate: {
    minWidth: 74,
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  name: { color: theme.text, fontSize: 10, fontWeight: '700' },
  stack: { color: theme.dim, fontSize: 9 },
  banker: { fontSize: 8, fontWeight: '900' },
  bet: { color: theme.dim, fontSize: 9 },
  net: { fontSize: 10, fontWeight: '900' },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: theme.jackpot,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
  },
  badgeText: { color: '#000', fontSize: 9, fontWeight: '900' },
  controls: { gap: space.sm, alignItems: 'center', paddingHorizontal: space.md },
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center' },
  hint: { color: theme.dim, fontSize: 11, textAlign: 'center' },
  chip: {
    width: 46,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: theme.jackpot },
  chipText: { color: theme.text, fontSize: 11, fontWeight: '800' },
  chipTextOn: { color: '#000' },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
  },
  pillOn: { backgroundColor: theme.jackpot },
  pillText: { color: theme.text, fontSize: 12, fontWeight: '800' },
  pillTextOn: { color: '#000' },
  primary: {
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: radius.card,
    backgroundColor: theme.brand,
  },
  primaryOff: { opacity: 0.5 },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
