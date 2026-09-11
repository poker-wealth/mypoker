import { useState, useEffect, useMemo } from 'react';
import * as Clipboard from 'expo-clipboard';

/**
 * Where a shared table link points.
 *
 * The APP host. It was `mypoker777.com`, which is the MARKETING domain — a
 * friend who tapped an invite got the landing page instead of the table.
 * Override with EXPO_PUBLIC_WEB_URL if the host ever moves.
 */
const TABLE_LINK_BASE = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://app.mypoker777.com';

/** The bot the Mini App lives behind. Mirrors the web's TELEGRAM_BOT_NAME. */
const TELEGRAM_BOT = process.env.EXPO_PUBLIC_TELEGRAM_BOT ?? 'mypoker777_bot';

/**
 * The link a creator shares.
 *
 * A plain web URL opens the phone's BROWSER — a fresh session, so the friend
 * you invited meets a sign-in page rather than your table. This opens the
 * Telegram Mini App instead: already authenticated as them, and routed to the
 * table by the `startapp` token.
 *
 * The token packs the id and the private code as `<id>__<code>`, which is what
 * `frontend/src/lib/tableInvite.ts` parses. Telegram allows only A-Za-z0-9_-
 * in `startapp`, up to 64 characters; a packed pair is about 21.
 */
function inviteLinkFor(tableId: string, joinCode?: string | null): string {
  const token = joinCode ? `${tableId}__${joinCode}` : tableId;
  return `https://t.me/${TELEGRAM_BOT}/app?startapp=${token}`;
}
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { Svg, Path } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '../api';
import type { RootStackParamList } from '../navigation';
import { radius, space, theme, weight } from '../theme';
import { useContextStore } from '../store/context';
import { Button, Sheet, Dialog, DiscreteSlider, DiscreteRangeSlider, ToggleRow, PokerChip, Badge } from '../ui';
import { money } from '../money';

const STAKES = [
  { sb: 1, bb: 2 },
  { sb: 2, bb: 4 },
  { sb: 5, bb: 10 },
  { sb: 10, bb: 20 },
  { sb: 25, bb: 50 },
  { sb: 50, bb: 100 },
  { sb: 100, bb: 200 },
  { sb: 250, bb: 500 },
];

/** Mirrors PokerVariant.maxSeats on the server — all three variants are 8. */
const POKER_MAX_SEATS = 8;

/**
 * Minimum buy-ins offered, in big blinds.
 *
 * Capped at 500 because that is the server's ceiling for `buyInBB`; the stops
 * above it (600, 800) could only ever be refused.
 */
const BUY_IN_STOPS_BB = [50, 100, 150, 200, 250, 300, 400, 500];
const MAX_MIN_BUY_IN_BB = 400;

const AUTO_START = [2, 3, 5, 7, 9];

const label100bb = (bb: number): string => {
  const x = bb / 100;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
};

interface League {
  leagueId: string;
  name: string;
}

export function CreateTableSheet({
  league,
  initialVariant,
  open,
  onClose,
}: {
  league?: League | null;
  initialVariant?: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const enterLeague = useContextStore((s) => s.enterLeague);
  const activeLeagueId = useContextStore((s) => s.leagueId);
  const effectiveLeagueId = league?.leagueId || activeLeagueId;

  const balance = useQuery({
    queryKey: ['me', 'balance'],
    queryFn: () => api.get<{ available: string }>('/me/balance'),
    staleTime: 60_000,
  });

  const [game, setGame] = useState<string>('texas');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [stakeIx, setStakeIx] = useState(0);
  const [seats, setSeats] = useState(POKER_MAX_SEATS);
  const [autoStart, setAutoStart] = useState(2);
  const [ante, setAnte] = useState(0);
  const [buyInLowBB, setBuyInLowBB] = useState(100);
  const [buyInHighBB, setBuyInHighBB] = useState(400);

  const [restrictOnlookers, setRestrictOnlookers] = useState(false);
  const [straddle, setStraddle] = useState(false);
  const [insurance, setInsurance] = useState(true);
  const [banSameGps, setBanSameGps] = useState(false);
  const [banSameIp, setBanSameIp] = useState(false);
  const [allInOrFold, setAllInOrFold] = useState(false);
  const [hideHoleCards, setHideHoleCards] = useState(false);

  useEffect(() => {
    if (open && initialVariant) {
      setGame(initialVariant);
    }
  }, [open, initialVariant]);

  const { sb, bb } = STAKES[stakeIx]!;
  const isPoker = game === 'texas' || game === 'short-deck' || game === 'omaha';
  
  /**
   * Chairs a table may have.
   *
   * EIGHT for every poker variant, which is what the SERVER allows —
   * `PokerVariant.maxSeats` in game-server/src/games/texas/variants.ts, and the
   * ceiling the felt art actually draws seats up to.
   *
   * This used to guess per game (texas 9, short deck 6) and both were wrong.
   * The 9 was fatal rather than cosmetic: the create endpoint bounds `seats` by
   * the largest cap across variants, so a default of 9 was rejected before any
   * other field was read — every "Start now" returned 400 'invalid table
   * settings', and with no error shown the sheet looked like it did nothing.
   */
  const seatCap = isPoker ? POKER_MAX_SEATS : 2;
  const seatsClamped = Math.min(seats, seatCap);

  const stakeStops = STAKES.map((s, i) => ({ value: i, label: `${s.sb}/${s.bb}` }));
  const seatStops = Array.from({ length: seatCap - 1 }, (_, i) => ({
    value: i + 2,
    label: String(i + 2),
  }));
  const autoStartStops = [
    { value: 0, label: 'None' },
    ...AUTO_START.filter((n) => n <= seatsClamped).map((n) => ({ value: n, label: String(n) })),
  ];
  
  const anteStops = useMemo(() => {
    const values = [...new Set([0, Math.ceil(bb / 4), Math.ceil(bb / 2), bb, bb * 2])];
    return values.map((v) => ({ value: v, label: String(v) }));
  }, [bb]);
  
  const buyInStops = BUY_IN_STOPS_BB.map((v) => ({ value: v, label: label100bb(v) }));

  const aofAllowed = game !== 'omaha';
  const [copied, setCopied] = useState(false);
  /** The server's refusal, shown instead of the button silently resetting. */
  const [failed, setFailed] = useState<string | null>(null);


  const create = useMutation({
    mutationFn: (body: any) =>
      api.post<any>(
        effectiveLeagueId ? `/leagues/${encodeURIComponent(effectiveLeagueId)}/tables` : '/tables',
        body
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lobby', 'tables'] });
    },
    onError: (err: unknown) => {
      // Without this the sheet said NOTHING when the server refused: the
      // button read 'Starting…', went back to 'Start now', and the table
      // never appeared. A refusal has a reason and the creator should see it.
      setFailed(err instanceof Error ? err.message : 'Could not create the table.');
    },
  });

  const close = (): void => {
    setCopied(false);
    setFailed(null);
    create.reset();
    onClose();
  };

  const submit = (): void => {
    if (!isPoker) {
      create.mutate({ game, visibility });
      return;
    }
    create.mutate({
      game,
      visibility,
      seats: seatsClamped,
      smallBlind: sb,
      bigBlind: bb,
      buyInBB: buyInLowBB,
      buyInMaxBB: buyInHighBB,
      ante,
      straddle,
      allInOrFold: aofAllowed && allInOrFold,
      hideHoleCards,
      spectatorsAllowed: !restrictOnlookers,
      insuranceEnabled: insurance,
      banSameIp,
      banSameGps,
      autoStartPlayers: Math.min(autoStart, seatsClamped),
    });
  };

  const goToTable = () => {
    if (!create.data) return;
    if (effectiveLeagueId) {
      enterLeague(effectiveLeagueId, league?.name || 'League');
    }
    navigation.navigate('Table', { tableId: create.data.tableId });
    close();
  };

  if (create.isSuccess && create.data) {
    const link = inviteLinkFor(create.data.tableId, create.data.joinCode);
    return (
      <Dialog open={open} onClose={close} title={t(`gameNames.${game}`, { defaultValue: 'Texas Hold\'em' })}>
        <View style={{ gap: space.lg, paddingVertical: space.md }}>
          {/* One bordered card holds the confirmation, the blurb and the link —
              the Mini App's shape, so a player meets the same dialog whichever
              client they created from. 'Enter table' sits outside it. */}
          <View style={styles.readyCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.brand} strokeWidth={2}>
                <Path d="M20 6L9 17l-5-5" />
              </Svg>
              <Text style={{ color: 'white', fontSize: 18, fontFamily: weight('700') }}>
                Your table is ready
              </Text>
            </View>
            <Text style={{ color: theme.dim, fontSize: 13 }}>
              Send this link to invite a friend to this exact table.
            </Text>

          {/* The copy control lives ON the link, not under it — same shape as
              the Mini App's. A separate label below read as a caption and
              nobody could tell it was tappable. */}
          <Pressable
            onPress={() => {
              void Clipboard.setStringAsync(link);
              setCopied(true);
            }}
            style={{
              backgroundColor: theme.surface2,
              borderRadius: radius.card,
              padding: space.md,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
            }}
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={theme.dim} strokeWidth={2}>
              <Path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <Path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </Svg>
            <Text
              style={{ color: 'white', fontSize: 13, fontFamily: weight('600'), flex: 1 }}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {link}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                borderRadius: 999,
                paddingHorizontal: space.sm,
                paddingVertical: 4,
                backgroundColor: copied ? 'rgba(63,208,122,0.15)' : 'rgba(217,184,124,0.15)',
              }}
            >
              <Svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={copied ? theme.success : theme.brand} strokeWidth={2.5}>
                {copied ? <Path d="M20 6L9 17l-5-5" /> : <Path d="M8 8h11v11H8zM5 5h11v3H8v8H5z" />}
              </Svg>
              <Text style={{ color: copied ? theme.success : theme.brand, fontSize: 11, fontFamily: weight('800') }}>
                {copied ? 'Link copied' : 'Copy'}
              </Text>
            </View>
          </Pressable>

          </View>

          <Button onPress={goToTable} style={{ backgroundColor: '#D4AF37' }}>
            <Text style={{ color: 'white', fontSize: 16, fontFamily: weight('800') }}>Enter table</Text>
          </Button>
        </View>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onClose={close} title="Create a game">
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {isPoker && (
            <>
              {/* Blinds Hero */}
              <View style={styles.blindsHero}>
                <View>
                  <Text style={styles.blindsHeroValue}>{sb}/{bb}</Text>
                  <Text style={styles.blindsHeroLabel}>Blinds</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <PokerChip />
                    <Text style={styles.blindsHeroBuy}>{(bb * buyInLowBB).toLocaleString()}</Text>
                  </View>
                  <Text style={styles.blindsHeroLabel}>Buy-in</Text>
                </View>
              </View>

              <DiscreteSlider options={stakeStops} value={stakeIx} onChange={setStakeIx} />

              <View style={styles.sliderGroup}>
                <Text style={styles.sliderTitle}>Players</Text>
                <DiscreteSlider options={seatStops} value={seatsClamped} onChange={setSeats} />
              </View>

              <View style={styles.sliderGroup}>
                <Text style={styles.sliderTitle}>Auto-start players count</Text>
                <DiscreteSlider options={autoStartStops} value={Math.min(autoStart, seatsClamped)} onChange={setAutoStart} />
              </View>

              <View style={styles.sliderGroup}>
                <Text style={styles.sliderTitle}>Ante</Text>
                <DiscreteSlider
                  options={anteStops}
                  value={anteStops.some((s) => s.value === ante) ? ante : 0}
                  onChange={setAnte}
                />
              </View>

              <View style={styles.sliderGroup}>
                <View style={styles.titleRow}>
                  <Text style={styles.sliderTitle}>Game length</Text>
                  <Badge tone="neutral">Soon</Badge>
                </View>
                <DiscreteSlider
                  options={['1', '1.5', '2', '2.5', '3', '4', '5', '6'].map((l, i) => ({ value: i, label: l }))}
                  value={0}
                  onChange={() => {}}
                  disabled
                />
              </View>

              <View style={styles.sliderGroup}>
                <Text style={styles.sliderTitle}>Buy-in amount (100BB)</Text>
                <DiscreteRangeSlider
                  options={buyInStops}
                  low={buyInLowBB}
                  high={buyInHighBB}
                  onChange={(lo, hi) => {
                    setBuyInLowBB(Math.min(lo, MAX_MIN_BUY_IN_BB));
                    setBuyInHighBB(hi);
                  }}
                />
                <Text style={styles.sliderHint}>
                  Allows {money(sb * buyInLowBB * 100, { decimals: 0 })} to {money(sb * buyInHighBB * 100, { decimals: 0 })}
                </Text>
              </View>

              <View style={styles.sliderGroup}>
                <View style={styles.titleRow}>
                  <Text style={styles.sliderTitle}>Min holding limit</Text>
                  <Badge tone="neutral">Soon</Badge>
                </View>
                <DiscreteSlider
                  options={['0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4'].map((l, i) => ({ value: i, label: l }))}
                  value={0}
                  onChange={() => {}}
                  disabled
                />
              </View>

              <View style={styles.sliderGroup}>
                <View style={styles.titleRow}>
                  <Text style={styles.sliderTitle}>VPIP Limit</Text>
                  <Badge tone="neutral">Soon</Badge>
                </View>
                <DiscreteSlider
                  options={['0', '25', '30', '35', '40', '45'].map((l, i) => ({ value: i, label: l }))}
                  value={0}
                  onChange={() => {}}
                  disabled
                />
              </View>

              <View style={styles.sliderGroup}>
                <View style={styles.titleRow}>
                  <Text style={styles.sliderTitle}>Service fee limit</Text>
                  <Badge tone="neutral">Soon</Badge>
                </View>
                <DiscreteSlider
                  options={['0', '0.5', '1', '1.5', '2', '2.5', '3', '5'].map((l, i) => ({ value: i, label: l }))}
                  value={0}
                  onChange={() => {}}
                  disabled
                />
              </View>

              <View style={styles.toggleList}>
                <ToggleRow
                  label="Restrict onlookers"
                  hint="Only seated players can watch"
                  checked={restrictOnlookers}
                  onChange={setRestrictOnlookers}
                />
                <ToggleRow
                  label="iOS system only"
                  checked={false}
                  onChange={() => {}}
                  soonLabel="Soon"
                />
                <ToggleRow
                  label="Straddle"
                  checked={straddle}
                  onChange={setStraddle}
                />
                <ToggleRow
                  label="Buy-in approval"
                  checked={false}
                  onChange={() => {}}
                  soonLabel="Soon"
                />
                <ToggleRow
                  label="Insurance"
                  hint="Offer insurance for all-in hands"
                  checked={insurance}
                  onChange={setInsurance}
                />
                <ToggleRow
                  label="GPS restriction"
                  checked={banSameGps}
                  onChange={setBanSameGps}
                />
                <ToggleRow
                  label="IP restriction"
                  checked={banSameIp}
                  onChange={setBanSameIp}
                />
                {aofAllowed && (
                  <ToggleRow
                    label="All-in or Fold"
                    checked={allInOrFold}
                    onChange={setAllInOrFold}
                  />
                )}
                <ToggleRow
                  label="Hide hole cards"
                  caption="Unrevealed cards stay hidden"
                  checked={hideHoleCards}
                  onChange={setHideHoleCards}
                />
                <ToggleRow
                  label="Cash-out chips"
                  checked={false}
                  onChange={() => {}}
                  soonLabel="Soon"
                />
              </View>
            </>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>

        {failed ? (
          <View style={styles.createError}>
            <Text style={styles.createErrorText}>{failed}</Text>
          </View>
        ) : null}
        <View style={styles.footer}>
          <View style={styles.footerInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.footerLabel}>Balance:</Text>
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth={2}>
                <Path d="M6 3h12l4 6-10 12L2 9l4-6z" />
              </Svg>
              <Text style={{ color: 'white', fontSize: 11, fontFamily: weight('700') }}>
                {balance.data ? `$${balance.data.available}` : '—'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.footerLabel}>Cost:</Text>
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth={2}>
                <Path d="M6 3h12l4 6-10 12L2 9l4-6z" />
              </Svg>
              <Text style={{ color: 'white', fontSize: 11, fontFamily: weight('700') }}>0</Text>
            </View>
          </View>
          <Button
            onPress={() => {
              setFailed(null);
              submit();
            }}
            disabled={create.isPending}
            style={{ paddingHorizontal: 32, backgroundColor: '#d9b87c' }}
          >
            <Text style={{ color: '#0c0c0c', fontFamily: weight('700'), fontSize: 14 }}>
              {create.isPending ? 'Starting...' : 'Start now'}
            </Text>
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginHorizontal: -space.md,
    marginTop: -space.md,
  },
  scrollContent: {
    padding: space.md,
    gap: space.lg,
  },
  blindsHero: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.sm,
  },
  blindsHeroValue: {
    color: '#D4AF37',
    fontSize: 32,
    fontFamily: weight('800'),
  },
  blindsHeroBuy: {
    color: 'white',
    fontSize: 24,
    fontFamily: weight('800'),
  },
  blindsHeroLabel: {
    color: theme.dim,
    fontSize: 11,
    fontFamily: weight('500'),
    marginTop: 2,
  },
  sliderGroup: {
    gap: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sliderTitle: {
    color: theme.dim,
    fontSize: 12,
    fontFamily: weight('600'),
  },
  sliderHint: {
    color: theme.dim,
    fontSize: 10,
    marginTop: 4,
  },
  toggleList: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.surface,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerInfo: {
    gap: 4,
  },
  readyCard: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  createError: {
    marginHorizontal: space.md,
    marginBottom: space.sm,
    padding: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.danger,
    backgroundColor: 'rgba(248,86,119,0.12)',
  },
  createErrorText: { color: theme.danger, fontSize: 12, fontFamily: weight('600'), textAlign: 'center' },
  footerLabel: {
    color: theme.dim,
    fontSize: 11,
    fontFamily: weight('500'),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
