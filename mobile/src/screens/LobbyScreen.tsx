import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Image, ImageBackground, Pressable, ScrollView, StyleSheet, Text, View, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { api } from '../api';
import type { RootStackParamList, TabParamList } from '../navigation';
import { money } from '../money';
import { radius, space, theme, weight } from '../theme';
import { Screen, Skeleton } from '../ui';
import { GAMES } from '../games';
import { useContextStore } from '../store/context';
import { ContextBanner } from '../components/ContextBanner';

/**
 * The promo banners, in order. `require` is deliberate — Metro resolves these
 * at build time, so a path that does not exist fails the bundle rather than
 * rendering an empty slide on someone's phone. Add a file and a line here to
 * extend the run; the dots and the timer both read this array's length, so
 * nothing else needs touching.
 */
const PROMO_SLIDES = [
  require('../../assets/brand/promo-bg.png'),
  require('../../assets/brand/promo-bg2.png'),
  require('../../assets/brand/promo-bg3.png'),
  require('../../assets/brand/promo-bg4.png'),
];

/** How long a banner holds before the next one slides in. */
const PROMO_INTERVAL_MS = 5_000;

type TableStatus = 'UNAVAILABLE' | 'WAITING' | 'OPEN' | 'FULL';

interface LobbyTable {
  id: string;
  gameId: string;
  name: string;
  stakes: number | null;
  smallBlind?: number | null;
  players: number;
  maxPlayers: number;
  seatsFree: number;
  jackpot: number;
  buyInBB: number | null;
  status: TableStatus;
  youAreSeated?: boolean;
  waitingFor?: number;
}

interface GameSummary {
  gameId: string;
  name: string;
}

export function LobbyScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const tabNav = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const [view, setView] = useState<'home' | 'tables'>('home');
  
  const [game, setGame] = useState<string>('texas');
  const [blindFilter, setBlindFilter] = useState('ALL');
  const blindOptions = ['ALL', '1/2', '5/10', '25/50', '100/200'];

  const leagueId = useContextStore((s) => s.leagueId);

  const gamesQuery = useQuery({
    queryKey: ['lobby', 'games'],
    queryFn: () => api.get<{ games: GameSummary[]; totalJackpot: number }>('/lobby/games'),
    staleTime: 30_000,
  });

  const tables = useQuery({
    queryKey: ['lobby', 'tables', game, leagueId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (game !== 'others') params.set('gameId', game);
      if (leagueId) params.set('leagueId', leagueId);
      const qs = params.toString();
      return api.get<{ tables: LobbyTable[] }>(`/lobby/tables${qs ? `?${qs}` : ''}`);
    },
    select: (data) => {
      if (game === 'others') {
        return { tables: data.tables.filter((t) => t.gameId !== 'texas' && t.gameId !== 'omaha') };
      }
      return data;
    },
    staleTime: 5_000,
    refetchInterval: 15_000,
    enabled: view === 'tables',
  });

  const filters = [
    { value: 'texas', label: 'DEZHOU' },
    { value: 'omaha', label: 'AUSHA' },
    { value: 'others', label: 'OTHERS' },
  ];

  const totalJackpot = gamesQuery.data?.totalJackpot;
  const [activeSlide, setActiveSlide] = useState(0);
  const promoRef = useRef<ScrollView>(null);
  /** Measured, not guessed: the carousel is inset from the screen edges. */
  const [promoWidth, setPromoWidth] = useState(0);
  const [promoPaused, setPromoPaused] = useState(false);

  /**
   * Advance the banners on their own.
   *
   * Waits for a real measured width — scrolling to a multiple of zero moves
   * nothing, which is how a "slideshow" ends up sitting on slide one forever.
   * Rebuilt whenever the slide, width or pause state changes, so each tick is
   * scheduled from the banner actually on screen rather than from a stale one.
   */
  useEffect(() => {
    if (promoWidth === 0 || promoPaused || PROMO_SLIDES.length < 2) return;
    const id = setTimeout(() => {
      const next = (activeSlide + 1) % PROMO_SLIDES.length;
      promoRef.current?.scrollTo({ x: next * promoWidth, animated: true });
      setActiveSlide(next);
    }, PROMO_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [activeSlide, promoWidth, promoPaused]);

  if (view === 'tables') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => setView('home')} style={styles.backBtn}>
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
              <Path d="M15 18l-6-6 6-6" />
            </Svg>
          </Pressable>
          <Text style={styles.headerTitle}>Live Tables</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Game Filters */}
          <View style={styles.gameTabs}>
            {filters.map((f) => {
              const active = game === f.value;
              return (
                <Pressable
                  key={f.value}
                  onPress={() => setGame(f.value)}
                  style={[styles.gameTab, active && styles.gameTabActive]}
                >
                  <Text style={[styles.gameTabText, active && styles.gameTabTextActive]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Blind Filters */}
          <View style={styles.blindTabsContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blindTabs}>
              {blindOptions.map((opt) => (
                <Pressable
                  key={opt}
                  onPress={() => setBlindFilter(opt)}
                  style={[styles.blindTab, blindFilter === opt && styles.blindTabActive]}
                >
                  <Text style={[styles.blindTabText, blindFilter === opt && styles.blindTabTextActive]}>{opt}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={styles.filterBtn}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.dim} strokeWidth={2}>
                <Path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
              </Svg>
            </Pressable>
          </View>

          {/* Table List */}
          <Screen
            query={tables}
            empty={{
              when: (d) => d.tables.length === 0,
              title: t('lobby.noTables'),
            }}
            errorLabel={{ retry: t('common.retry'), fallback: t('states.error') }}
          >
            {(data) => (
              <View style={styles.tableList}>
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.th, { flex: 1.5 }]}>TABLE</Text>
                  <Text style={[styles.th, { flex: 1 }]}>BLINDS</Text>
                  <Text style={[styles.th, { flex: 1.5, textAlign: 'center' }]}>PLAYERS</Text>
                  <Text style={[styles.th, { flex: 1, textAlign: 'center' }]}>BUY-IN</Text>
                  <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>STATUS</Text>
                </View>

                {data.tables.map((tbl, i) => (
                  <Pressable
                    key={tbl.id}
                    style={[styles.tr, i > 0 && styles.trBorder]}
                    onPress={() => navigation.navigate('Table', { tableId: tbl.id })}
                  >
                    <Text style={[styles.td, styles.tdName, { flex: 1.5 }]} numberOfLines={1}>{tbl.name || tbl.gameId}</Text>
                    
                    <Text style={[styles.td, { flex: 1 }]}>
                      {tbl.stakes === null ? '—' : `${tbl.smallBlind ?? tbl.stakes}/${tbl.stakes}`}
                    </Text>
                    
                    <View style={[styles.tdPlayers, { flex: 1.5 }]}>
                      <Text style={styles.tdPlayersVal}>{tbl.players}</Text>
                      <Text style={styles.tdPlayersMax}> / {tbl.maxPlayers}</Text>
                    </View>
                    
                    <Text style={[styles.td, { flex: 1, textAlign: 'center' }]}>
                      {tbl.buyInBB ? `${tbl.buyInBB} BB` : '—'}
                    </Text>
                    
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      <View style={[styles.statusBtn, tbl.status !== 'OPEN' && tbl.status !== 'WAITING' && styles.statusBtnDisabled]}>
                        <Text style={styles.statusBtnText}>{tbl.status === 'WAITING' ? 'WAIT' : tbl.status}</Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </Screen>
        </ScrollView>
      </View>
    );
  }

  // Home View
  return (
    <View style={styles.container}>
      <ContextBanner />
      
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Promo Banner Slideshow */}
        <View style={styles.promoWrap}>
          <ScrollView
            ref={promoRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onLayout={(e) => setPromoWidth(e.nativeEvent.layout.width)}
            onScroll={(e) => {
              const slide = Math.round(e.nativeEvent.contentOffset.x / e.nativeEvent.layoutMeasurement.width);
              if (slide !== activeSlide) setActiveSlide(slide);
            }}
            // A drag pauses the timer: a banner yanked out from under a
            // thumb mid-swipe is worse than one that waits its turn.
            onScrollBeginDrag={() => setPromoPaused(true)}
            onScrollEndDrag={() => setPromoPaused(false)}
            scrollEventThrottle={16}
          >
            {PROMO_SLIDES.map((src, i) => (
              // Each banner is FINISHED artwork: the wordmark, the headlines
              // and the "View details by clicking" pill are painted into the
              // PNG. Drawing them again as Text on top is what printed every
              // line twice, overlapping itself — so a slide is the image and
              // nothing else.
              //
              // Deliberately NOT pressable yet: the art invites a tap, but no
              // promotions screen exists to open. A control that swallows a
              // tap and does nothing is worse than one that plainly waits.
              <ImageBackground
                key={i}
                source={src}
                style={[styles.promoSlide, promoWidth > 0 ? { width: promoWidth } : null]}
                imageStyle={styles.promoBgImage}
              />
            ))}
          </ScrollView>
          <View style={styles.promoDots}>
            {PROMO_SLIDES.map((_, i) => (
              <View key={i} style={[styles.promoDot, activeSlide === i && styles.promoDotActive]} />
            ))}
          </View>
        </View>

        {/* CREATE / JOIN — beneath the banner, so the artwork stays whole */}
        <View style={styles.promoActions}>
            <Pressable
              style={[styles.promoActionBtn, { borderTopLeftRadius: 16, borderBottomLeftRadius: 16, borderRightWidth: 1, borderRightColor: 'rgba(0,0,0,0.2)' }]}
              onPress={() => tabNav.navigate('Alliance')}
            >
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth={1.5}>
                <Rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <Path d="M12 8v8M8 12h8" />
              </Svg>
              <Text style={styles.promoActionText}>CREATE</Text>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth={2}><Path d="M9 18l6-6-6-6"/></Svg>
            </Pressable>
            <Pressable 
              style={[styles.promoActionBtn, { borderTopRightRadius: 16, borderBottomRightRadius: 16 }]}
              onPress={() => setView('tables')}
            >
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth={1.5}>
                <Rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <Circle cx="8.5" cy="8.5" r="1.5" fill="#000" />
                <Circle cx="15.5" cy="15.5" r="1.5" fill="#000" />
              </Svg>
              <Text style={styles.promoActionText}>JOIN</Text>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth={2}><Path d="M9 18l6-6-6-6"/></Svg>
            </Pressable>
          </View>

        {/* My Games Section */}
        <View style={styles.myGamesHeader}>
          <Text style={styles.myGamesTitle}>My Games</Text>
          <View style={styles.myGamesRight}>
            <View style={styles.publicTableToggle}>
              <View style={styles.publicTableToggleInner}>
                <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#D9B87C" strokeWidth={2}>
                  <Path d="M2 22h20M2 18l4-10 6 4 6-4 4 10H2z" />
                </Svg>
                <Text style={styles.publicTableToggleText}>Public Table</Text>
              </View>
            </View>
            <View style={styles.listIconWrap}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth={2}>
                <Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </Svg>
            </View>
          </View>
        </View>

        {/* Game filters — OUR catalogue (src/games.ts), not the reference's.
            The names are translated, the fire marks the games the catalogue
            actually flags `hot`, and a chip opens that game's tables rather
            than sitting there as decoration. */}
        <View style={styles.filterGrid}>
          <View style={styles.filterRowWrap}>
            <Pressable
              onPress={() => {
                setGame('texas');
                setView('tables');
              }}
              style={[styles.filterChip, styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, { color: '#000' }]}>{t('games.filterAll')}</Text>
            </Pressable>
            {GAMES.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => {
                  setGame(g.id);
                  setView('tables');
                }}
              >
                <Text style={styles.filterText}>
                  {g.hot ? '🔥' : ''}
                  {t(`gameNames.${g.id}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Tournament Section */}
        <View style={styles.tournamentHeader}>
          <Text style={styles.tournamentTitle}>Tournament</Text>
          <View style={styles.tournamentFilters}>
            <Text style={styles.tournamentFilterLabel}>Hot:</Text>
            <View style={styles.tournamentHotGrid}>
              <Text style={styles.filterText}>🔥CrazyClown</Text>
              <Text style={styles.filterText}>🔥SD</Text>
              <Text style={styles.filterText}>🔥AOF</Text>
              <Text style={styles.filterText}>🔥Voiceprint</Text>
            </View>
          </View>
        </View>

        {/* Tournament Cards */}
        <View style={styles.tournamentCards}>
          <View style={styles.tourneyCard}>
            <View style={styles.tourneyTop}>
              <Image source={require('../../assets/brand/trophy.png')} style={{width: 24, height: 24}} />
              <Text style={styles.tourneyName}>Golden Freeroll-8 Max</Text>
            </View>
            <View style={styles.tourneyBottom}>
              <View style={styles.tourneyInfo}>
                <Text style={styles.tourneyType}>MTT</Text>
                <Text style={styles.tourneyTime}>02:00 09-06</Text>
                <Text style={styles.tourneyPrize}>500</Text>
                <Text style={styles.tourneyFee}>0</Text>
              </View>
              <Pressable style={styles.tourneyBtnWatch}>
                <Text style={styles.tourneyBtnText}>Watch</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.tourneyCard}>
            <View style={styles.tourneyTop}>
              <Image source={require('../../assets/brand/trophy.png')} style={{width: 24, height: 24}} />
              <Text style={styles.tourneyName}>Diamond Tournament -9 Max</Text>
            </View>
            <View style={styles.tourneyBottom}>
              <View style={styles.tourneyInfo}>
                <Text style={styles.tourneyType}>MTT</Text>
                <Text style={styles.tourneyTime}>04:00 09-07</Text>
                <Text style={styles.tourneyPrize}>500</Text>
                <Text style={styles.tourneyFee}>50</Text>
              </View>
              <Pressable style={styles.tourneyBtnReg}>
                <Text style={styles.tourneyBtnTextOnGold}>Register</Text>
              </Pressable>
            </View>
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    backgroundColor: theme.bg,
  },
  headerTitle: { color: 'white', fontSize: 18, fontFamily: weight('800') },
  backBtn: { padding: 4 },
  scrollContent: { padding: space.lg, gap: space.lg, paddingBottom: 100 },
  
  // Home View specific styles
  promoWrap: { height: 140, marginBottom: 32, marginTop: space.md },
  promoSlide: { width: Dimensions.get('window').width - (space.lg * 2), flex: 1, justifyContent: 'center', paddingLeft: space.lg },
  promoBgImage: { borderRadius: 16 },
  promoContent: { alignItems: 'flex-start', gap: 4, marginBottom: 20 },
  promoTitle1: { color: '#81E8C6', fontSize: 20, fontFamily: weight('900'), textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2, letterSpacing: -0.5 },
  promoTitle2Wrap: { backgroundColor: '#0F5435', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: '#4ADE80' },
  promoTitle2: { color: 'white', fontSize: 16, fontFamily: weight('900'), fontStyle: 'italic', letterSpacing: -0.5 },
  promoBtn: { backgroundColor: '#FDE047', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, marginTop: 4 },
  promoBtnText: { color: '#000', fontSize: 11, fontFamily: weight('800') },
  promoDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, position: 'absolute', bottom: 12, width: '100%' },
  promoDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  promoDotActive: { backgroundColor: 'white', width: 14 },
  
  // Sits BELOW the banner, not over it. It used to be absolutely positioned
  // at bottom:-22, which laid the gold bar across the artwork and hid the
  // "View details by clicking" pill painted into the image.
  promoActions: {
    flexDirection: 'row',
    marginTop: space.md,
    marginHorizontal: space.lg,
    height: 48,
    backgroundColor: '#EED9A0',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  promoActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  promoActionText: { color: '#000', fontSize: 15, fontFamily: weight('800'), letterSpacing: 0.5 },

  myGamesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  myGamesTitle: { color: '#EED9A0', fontSize: 18, fontFamily: weight('800') },
  myGamesRight: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EED9A0', borderRadius: 20, padding: 2 },
  publicTableToggle: { backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 },
  publicTableToggleInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  publicTableToggleText: { color: '#000', fontSize: 10, fontFamily: weight('800') },
  listIconWrap: { paddingHorizontal: 10 },

  filterGrid: { backgroundColor: theme.surface, borderRadius: 16, padding: space.md, gap: space.md },
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Wraps: our catalogue has more games than the reference's fixed two rows.
  filterRowWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.md, rowGap: space.sm },
  filterChip: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#D9B87C' },
  filterChipActive: { backgroundColor: '#D9B87C' },
  filterChipText: { fontSize: 12, fontFamily: weight('800') },
  filterText: { color: theme.dim, fontSize: 13, fontFamily: weight('600') },

  tournamentHeader: { marginTop: space.sm },
  tournamentTitle: { color: theme.dim, fontSize: 14, fontFamily: weight('800'), marginBottom: space.sm },
  tournamentFilters: { backgroundColor: theme.surface, borderRadius: 16, padding: space.md, flexDirection: 'row', gap: space.md },
  tournamentFilterLabel: { color: theme.dim, fontSize: 13, fontFamily: weight('600') },
  tournamentHotGrid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: space.md },

  tournamentCards: { gap: space.md, marginTop: space.sm },
  tourneyCard: { backgroundColor: '#212A2D', borderRadius: 12, padding: space.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  tourneyTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: space.md },
  tourneyName: { color: 'white', fontSize: 15, fontFamily: weight('800') },
  tourneyBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  tourneyInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tourneyType: { color: theme.dim, fontSize: 12, fontFamily: weight('800') },
  tourneyTime: { color: theme.dim, fontSize: 12 },
  tourneyPrize: { color: '#D9B87C', fontSize: 12, fontFamily: weight('700') },
  tourneyFee: { color: '#4ADE80', fontSize: 12, fontFamily: weight('700') },
  tourneyBtnWatch: { backgroundColor: 'rgba(238,217,160,0.2)', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
  tourneyBtnReg: { backgroundColor: '#EED9A0', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
  tourneyBtnText: { color: '#EED9A0', fontSize: 12, fontFamily: weight('800') },
  // Register is a SOLID gold pill, so its label cannot also be gold — that is
  // why the button rendered blank. Dark ink on gold, like the Sign in button.
  tourneyBtnTextOnGold: { color: '#1A1A1A', fontSize: 12, fontFamily: weight('800') },

  // Tables View specific styles
  gameTabs: { flexDirection: 'row', gap: space.sm },
  gameTab: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
    borderRadius: 8,
    backgroundColor: theme.surface2,
  },
  gameTabActive: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.success,
  },
  gameTabText: { color: theme.dim, fontSize: 12, fontFamily: weight('800') },
  gameTabTextActive: { color: theme.success },

  blindTabsContainer: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  blindTabs: { gap: space.sm },
  blindTab: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: 8,
    backgroundColor: theme.surface2,
  },
  blindTabActive: { backgroundColor: theme.success },
  blindTabText: { color: theme.dim, fontSize: 13, fontFamily: weight('700') },
  blindTabTextActive: { color: 'white' },
  filterBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: theme.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  tableList: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderColor: theme.border,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  th: { color: theme.dim, fontSize: 10, fontFamily: weight('800'), letterSpacing: 0.5 },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  trBorder: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.03)' },
  td: { color: theme.dim, fontSize: 13, fontFamily: weight('500') },
  tdName: { color: theme.brand, fontFamily: weight('800') },
  tdPlayers: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' },
  tdPlayersVal: { color: 'white', fontSize: 14, fontFamily: weight('800') },
  tdPlayersMax: { color: theme.dim, fontSize: 12, fontFamily: weight('600') },
  
  statusBtn: {
    backgroundColor: 'rgba(63,208,122,0.15)',
    borderColor: theme.success,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  statusBtnDisabled: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
  },
  statusBtnText: { color: theme.success, fontSize: 11, fontFamily: weight('800') },

  actionRow: {
    position: 'absolute',
    bottom: 20,
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    gap: space.md,
  },
  btnQuick: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: theme.success,
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnQuickText: { color: 'white', fontSize: 14, fontFamily: weight('800') },
  btnCreate: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: theme.surface2,
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnCreateIcon: { color: 'white', fontSize: 18, fontFamily: weight('400'), marginTop: -2 },
  btnCreateText: { color: 'white', fontSize: 12, fontFamily: weight('800') },
});
