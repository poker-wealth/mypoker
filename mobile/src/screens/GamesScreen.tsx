import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { api } from '../api';
import { GameTile } from '../components/GameTile';
import { visibleGames, type GameCategory, type GameDef } from '../lib/games';
import { money } from '../money';
import type { RootStackParamList } from '../navigation';
import { radius, space, theme } from '../theme';
import { Segmented, Skeleton } from '../ui';

/**
 * Games — where the games actually live.
 *
 * Ported from `frontend/src/pages/Games.tsx`. This is the Mini App's second tab and it had no
 * mobile equivalent at all: search, the jackpot hero, category filters, and the grid of games
 * grouped into Poker / Card / Quick.
 *
 * It matters more than "another screen". A tile opens `Table` with the GAME id — `texas`,
 * `niu-niu`, `red-packet` — and those are exactly the rooms game-server mounts. So this is the
 * route into the felts that actually resolves, where the lobby's catalogue ids (`tx-1`) reach no
 * room at all.
 *
 * `visibleGames()`, never `GAMES`: the launch gate lives in that filter, and the web page shipped
 * a bug where iterating the raw list rendered a withheld game as a tappable tile that opened a real
 * table.
 */

type Filter = 'all' | GameCategory;

/** Announced but not built. Named here so the screen cannot imply they are playable. */
const COMING_SOON = ['blackjack', 'sicbo', 'fishingWar', 'setteMezzo'];

interface LobbyGames {
  games: { gameId: string; tables: number; jackpot: number }[];
  totalJackpot: number;
}

export function GamesScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [cat, setCat] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const lobby = useQuery({
    queryKey: ['lobby', 'games'],
    queryFn: () => api.get<LobbyGames>('/lobby/games'),
    staleTime: 30_000,
  });

  // Live figures per game. Undefined for a game the lobby did not mention — the tile shows a dash.
  const live = new Map((lobby.data?.games ?? []).map((g) => [g.gameId, g]));

  const query = q.trim().toLowerCase();
  const games = visibleGames();

  const shown = (list: GameDef[]): GameDef[] =>
    list.filter((g) => {
      const inCat = cat === 'all' || g.category === cat;
      const localised = t(`gameNames.${g.id}`, { defaultValue: g.name }).toLowerCase();
      const inQuery = !query || g.name.toLowerCase().includes(query) || localised.includes(query);
      return inCat && inQuery;
    });

  const grouped = {
    poker: shown(games.filter((g) => g.category === 'poker')),
    card: shown(games.filter((g) => g.category === 'card')),
    quick: shown(games.filter((g) => g.category === 'quick' || g.category === 'arcade')),
  };

  const open = (id: string): void => navigation.navigate('Table', { tableId: id });

  const section = (title: string, list: GameDef[]) =>
    list.length === 0 ? null : (
      <View key={title} style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.grid}>
          {list.map((g) => (
            <View key={g.id} style={styles.cell}>
              <GameTile
                game={g}
                {...(live.get(g.id)?.tables === undefined ? {} : { tables: live.get(g.id)!.tables })}
                {...(live.get(g.id)?.jackpot === undefined ? {} : { jackpot: live.get(g.id)!.jackpot })}
                onPress={() => open(g.id)}
              />
            </View>
          ))}
          {/* Keeps the last row left-aligned on a three-column grid. */}
          {list.length % 3 === 2 ? <View style={styles.cell} /> : null}
          {list.length % 3 === 1 ? (
            <>
              <View style={styles.cell} />
              <View style={styles.cell} />
            </>
          ) : null}
        </View>
      </View>
    );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.search}>
        <Text style={styles.searchGlyph}>⌕</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t('games.searchPlaceholder')}
          placeholderTextColor={theme.dim}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* The jackpot hero. Same gradient stops and trophy as the Mini App; SVG only because React
          Native has no CSS gradients. See LobbyScreen for the same note. */}
      <View style={styles.hero}>
        <Svg style={StyleSheet.absoluteFill as never} width="100%" height="100%">
          <Defs>
            <LinearGradient id="gamesHero" x1="0" y1="0" x2="1" y2="0.6">
              <Stop offset="0" stopColor="#4f46e5" />
              <Stop offset="0.55" stopColor="#7c3aed" />
              <Stop offset="1" stopColor="#0891b2" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" rx="18" fill="url(#gamesHero)" />
        </Svg>
        <Image
          source={require('../../assets/brand/trophy.png')}
          resizeMode="contain"
          style={styles.heroTrophy}
        />
        <View style={styles.heroText}>
          <Text style={styles.heroLabel}>{t('lobby.grandJackpot').toUpperCase()}</Text>
          {lobby.isPending ? (
            <Skeleton width={180} />
          ) : (
            // An em dash when the pools are unknown. "$0.00" would claim there is nothing to win.
            <Text style={styles.heroAmount}>
              {lobby.data ? money(lobby.data.totalJackpot) : '—'}
            </Text>
          )}
        </View>
      </View>

      <Segmented
        value={cat}
        onChange={setCat}
        options={[
          { value: 'all', label: 'ALL' },
          { value: 'poker', label: 'POKER' },
          { value: 'card', label: 'CARD' },
          { value: 'arcade', label: 'ARCADE' },
          { value: 'quick', label: 'QUICK' },
        ]}
      />

      {section(t('games.sectionPoker').toUpperCase(), grouped.poker)}
      {section(t('games.sectionCard').toUpperCase(), grouped.card)}
      {section(t('games.sectionQuick').toUpperCase(), grouped.quick)}

      {grouped.poker.length + grouped.card.length + grouped.quick.length === 0 ? (
        <Text style={styles.noMatch}>{t('games.noMatch', { query: q })}</Text>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.comingTitle}>{t('games.comingSoon')}</Text>
        <View style={styles.comingGrid}>
          {COMING_SOON.map((id) => (
            <View key={id} style={styles.comingRow}>
              <Text style={styles.comingName}>{t(`gameNames.${id}`, { defaultValue: id })}</Text>
              <Text style={styles.comingBadge}>{t('games.soonBadge')}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: space.md, gap: space.lg, paddingBottom: space.xl },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  searchGlyph: { color: theme.dim, fontSize: 18 },
  searchInput: { flex: 1, color: theme.text, fontSize: 14, paddingVertical: 8 },
  hero: {
    height: 128,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    overflow: 'hidden',
  },
  // Explicit width AND height. 'top/bottom' with no height leaves an absolutely-positioned
  // Image with no intrinsic box on Android, and it renders nothing at all — silently.
  heroTrophy: { position: 'absolute', left: 8, top: 8, width: 104, height: 112 },
  heroText: { alignItems: 'center', gap: 2, paddingLeft: 84 },
  heroLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  heroAmount: { color: '#facc15', fontSize: 34, fontWeight: '900' },
  section: { gap: space.sm },
  sectionTitle: { color: theme.text, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // Three per row, allowing for the two gaps between them.
  cell: { width: '31.5%' },
  noMatch: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingVertical: 40,
    textAlign: 'center',
    color: theme.dim,
    fontSize: 13,
  },
  comingTitle: { color: theme.dim, fontSize: 14, fontWeight: '700' },
  comingGrid: { gap: space.sm },
  comingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 60,
    paddingHorizontal: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.border,
    backgroundColor: 'rgba(23,23,43,0.5)',
  },
  comingName: { color: theme.dim, fontSize: 13, fontWeight: '600' },
  comingBadge: {
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    paddingHorizontal: 8,
    paddingVertical: 2,
    color: theme.dim,
    fontSize: 10,
    fontWeight: '700',
    overflow: 'hidden',
  },
});
