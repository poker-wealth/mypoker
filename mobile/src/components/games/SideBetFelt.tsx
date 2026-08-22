import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PlayingCard } from '../poker/PlayingCard';
import { radius, space, theme } from '../../theme';
import type { TableCommand, TableSnapshot } from '../../lib/liveTable';

/**
 * The shape three games share: pick a side, stake, watch it reveal.
 *
 * San Zhang, Cowboy & Beauty and Lottery are the same interaction with different words — a banker
 * or a pool, a couple of choices, one reveal. The Mini App has three separate felts because each
 * grew on its own; here they are one component with the differences passed in, because three
 * near-identical files drift and this cannot.
 *
 * What stays game-specific — Niu Niu's auction, Baccarat's two hands, Red Packet's grid — gets its
 * own felt. This is only for the ones that genuinely are the same screen.
 */

export interface SideOption {
  /** The action `type` the room expects. */
  id: string;
  label: string;
  tone: string;
  /** What it pays, when the game publishes odds. */
  pays?: string;
  /** Chips already on this side, when the game is parimutuel. */
  pool?: number;
}

export interface SideBetFeltProps {
  snapshot: TableSnapshot;
  onCommand: (cmd: TableCommand) => void;
  title: string;
  sides: SideOption[];
  /** Cards or symbols revealed at showdown, if the game reveals any. */
  reveal?: { label: string; cards: string[] }[];
  /** The line under the title — the result, or what the table is waiting for. */
  outcome?: string | null;
  /** Whether the banker sits this one out, as in the player-banked games. */
  bankerCannotBet?: boolean;
}

const CHIPS = [50, 100, 500, 1_000];

export function SideBetFelt({
  snapshot,
  onCommand,
  title,
  sides,
  reveal,
  outcome,
  bankerCannotBet,
}: SideBetFeltProps) {
  const [side, setSide] = useState<string>(sides[0]?.id ?? '');
  const [betAmount, setBetAmount] = useState(100);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const you = snapshot.seats.find((s) => s.isYou);
  const staked = you?.bet ?? 0;
  const inHand = snapshot.phase === 'IN_HAND';
  const youAreBanker = Boolean(you?.isDealer) && Boolean(bankerCannotBet);

  const secondsLeft = snapshot.actionDeadline
    ? Math.max(0, Math.ceil((snapshot.actionDeadline - now) / 1_000))
    : null;

  const sitDown = (): void => {
    const free = snapshot.seats.find((s) => !s.playerId);
    onCommand({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot.minBuyIn });
  };
  const back = (id: string): void => {
    setSide(id);
    if (you && inHand && !youAreBanker) {
      onCommand({ kind: 'act', action: { type: id, amount: betAmount } });
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.phase}>
          {secondsLeft !== null && inHand ? `${secondsLeft}s` : snapshot.phase}
        </Text>
      </View>

      {outcome ? <Text style={styles.outcome}>{outcome}</Text> : null}

      {reveal && reveal.length > 0 ? (
        <View style={styles.reveals}>
          {reveal.map((r) => (
            <View key={r.label} style={styles.revealCol}>
              <Text style={styles.revealLabel}>{r.label}</Text>
              <View style={styles.revealCards}>
                {r.cards.length > 0
                  ? r.cards.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
                  : [0].map((i) => <PlayingCard key={i} size="sm" faceDown />)}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.sides}>
        {sides.map((s) => {
          const yours = staked > 0 && side === s.id;
          return (
            <Pressable
              key={s.id}
              onPress={() => back(s.id)}
              style={[styles.side, yours && { borderColor: s.tone }]}
            >
              <Text style={[styles.sideLabel, { color: s.tone }]}>{s.label}</Text>
              {s.pays ? <Text style={styles.sidePays}>{s.pays}</Text> : null}
              {s.pool !== undefined ? (
                <Text style={styles.sidePool}>pool ₮{s.pool}</Text>
              ) : null}
              {yours ? (
                <View style={styles.stakeBadge}>
                  <Text style={styles.stakeText}>₮{staked}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.controls}>
        {!you ? (
          <Pressable onPress={sitDown} style={styles.primary}>
            <Text style={styles.primaryText}>Sit to Play</Text>
          </Pressable>
        ) : youAreBanker ? (
          <Text style={styles.hint}>You hold the bank — waiting on the bets</Text>
        ) : inHand ? (
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
            <Pressable onPress={() => back(side)} style={styles.primary}>
              <Text style={styles.primaryText}>
                {staked > 0 ? `Staked ₮${staked}` : `Stake ₮${betAmount}`}
              </Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.hint}>{snapshot.message ?? 'Waiting for the next round'}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: theme.jackpot, fontWeight: '900', letterSpacing: 1 },
  phase: { color: theme.dim, fontSize: 11 },
  outcome: { color: theme.jackpot, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  reveals: { flexDirection: 'row', justifyContent: 'center', gap: space.lg },
  revealCol: { alignItems: 'center', gap: 4 },
  revealLabel: { color: theme.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  revealCards: { flexDirection: 'row', gap: 2 },
  sides: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  side: {
    flex: 1,
    minWidth: 90,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  sideLabel: { fontWeight: '900', fontSize: 13 },
  sidePays: { color: theme.dim, fontSize: 10 },
  sidePool: { color: theme.dim, fontSize: 10 },
  stakeBadge: {
    position: 'absolute',
    top: -9,
    backgroundColor: theme.jackpot,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
  },
  stakeText: { color: '#000', fontSize: 10, fontWeight: '900' },
  controls: { gap: space.sm, alignItems: 'center' },
  row: { flexDirection: 'row', gap: space.sm },
  chip: {
    width: 52,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: theme.jackpot },
  chipText: { color: theme.text, fontSize: 11, fontWeight: '800' },
  chipTextOn: { color: '#000' },
  primary: {
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: radius.card,
    backgroundColor: theme.brand,
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  hint: { color: theme.dim, fontSize: 12, textAlign: 'center' },
});
