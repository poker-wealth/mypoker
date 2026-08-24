import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PlayingCard } from '../poker/PlayingCard';
import { radius, space, theme } from '../../theme';
import type { TableCommand, TableSnapshot } from '../../lib/liveTable';

/**
 * BACCARAT — two hands, three spots.
 *
 * Ported from `frontend/src/components/games/BaccaratFelt.tsx`. The whole game is Player vs Banker
 * and which of three spots holds your chips, so the felt shows both hands with their totals and
 * marks the one you backed.
 *
 * The hands arrive in `gameState`, apart. They used to travel as one array with a '|' between them,
 * which the web felt drew as a card face reading "|" — the room sends them separately now.
 */

/** Mirrors the `gameState` built in game-server/src/live/baccarat-room.ts. */
interface BaccaratRound {
  revealed: boolean;
  playerCards: string[];
  bankerCards: string[];
  playerTotal: number | null;
  bankerTotal: number | null;
  outcome: 'PLAYER' | 'BANKER' | 'TIE' | null;
  tiePayout: number;
}

type Spot = 'player' | 'banker' | 'tie';

const CHIPS = [50, 100, 500, 1_000];

export function BaccaratFelt({
  snapshot,
  onCommand,
}: {
  snapshot: TableSnapshot;
  onCommand: (cmd: TableCommand) => void;
}) {
  const [spot, setSpot] = useState<Spot>('player');
  const [betAmount, setBetAmount] = useState(100);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const round = snapshot.gameState as BaccaratRound | undefined;
  const you = snapshot.seats.find((s) => s.isYou);
  const staked = you?.bet ?? 0;
  const inHand = snapshot.phase === 'IN_HAND';

  const secondsLeft = snapshot.actionDeadline
    ? Math.max(0, Math.ceil((snapshot.actionDeadline - now) / 1_000))
    : null;

  const sitDown = (): void => {
    const free = snapshot.seats.find((s) => !s.playerId);
    onCommand({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot.minBuyIn });
  };
  const back = (type: Spot): void => {
    setSpot(type);
    if (you && inHand) onCommand({ kind: 'act', action: { type, amount: betAmount } });
  };

  const spots: { id: Spot; label: string; pays: string; tone: string }[] = [
    { id: 'player', label: 'PLAYER', pays: '1 : 1', tone: '#38bdf8' },
    { id: 'tie', label: 'TIE', pays: `${round?.tiePayout ?? 8} : 1`, tone: theme.success },
    { id: 'banker', label: 'BANKER', pays: '0.95 : 1', tone: theme.danger },
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>BACCARAT</Text>
        <Text style={styles.phase}>
          {secondsLeft !== null && inHand ? `${secondsLeft}s` : snapshot.phase}
        </Text>
      </View>

      <View style={styles.hands}>
        <Hand
          title="PLAYER"
          tone="#38bdf8"
          cards={round?.playerCards ?? []}
          total={round?.playerTotal ?? null}
          won={round?.outcome === 'PLAYER'}
        />
        <View style={styles.versus}>
          <Text style={styles.vsText}>VS</Text>
          {round?.outcome ? (
            <Text style={styles.outcome}>{round.outcome} WINS</Text>
          ) : null}
        </View>
        <Hand
          title="BANKER"
          tone={theme.danger}
          cards={round?.bankerCards ?? []}
          total={round?.bankerTotal ?? null}
          won={round?.outcome === 'BANKER'}
        />
      </View>

      <View style={styles.spots}>
        {spots.map((s) => {
          const yours = staked > 0 && spot === s.id;
          const won = round?.outcome === s.id.toUpperCase();
          return (
            <Pressable
              key={s.id}
              onPress={() => back(s.id)}
              style={[
                styles.spot,
                won && styles.spotWon,
                yours && !won && { borderColor: s.tone },
              ]}
            >
              <Text style={[styles.spotLabel, { color: s.tone }]}>{s.label}</Text>
              <Text style={styles.spotPays}>{s.pays}</Text>
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
            <Text style={styles.primaryText}>Sit to Play Baccarat</Text>
          </Pressable>
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
            <Pressable onPress={() => back(spot)} style={styles.primary}>
              <Text style={styles.primaryText}>
                {staked > 0 ? `Staked ₮${staked}` : `Back ${spot.toUpperCase()} for ₮${betAmount}`}
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

/** One side of the table: its cards, and the total they make. */
function Hand({
  title,
  tone,
  cards,
  total,
  won,
}: {
  title: string;
  tone: string;
  cards: string[];
  total: number | null;
  won: boolean;
}) {
  return (
    <View style={[styles.hand, won && styles.handWon]}>
      <Text style={[styles.handTitle, { color: tone }]}>{title}</Text>
      <View style={styles.handCards}>
        {cards.length > 0
          ? cards.map((c, i) => <PlayingCard key={i} card={c} size="md" />)
          : [0, 1].map((i) => <PlayingCard key={i} size="md" faceDown />)}
      </View>
      <Text style={styles.total}>{total ?? '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: theme.jackpot, fontWeight: '900', letterSpacing: 1 },
  phase: { color: theme.dim, fontSize: 11 },
  hands: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md },
  hand: {
    alignItems: 'center',
    gap: 4,
    padding: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  handWon: { borderColor: theme.jackpot, backgroundColor: 'rgba(245,185,59,0.12)' },
  handTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  handCards: { flexDirection: 'row', gap: 2 },
  total: { color: theme.text, fontSize: 20, fontWeight: '900' },
  versus: { alignItems: 'center', gap: 4 },
  vsText: { color: theme.dim, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  outcome: { color: theme.jackpot, fontSize: 10, fontWeight: '900' },
  spots: { flexDirection: 'row', gap: space.sm },
  spot: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  spotWon: { borderColor: theme.jackpot, backgroundColor: 'rgba(245,185,59,0.12)' },
  spotLabel: { fontWeight: '900', fontSize: 14 },
  spotPays: { color: theme.dim, fontSize: 10 },
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
