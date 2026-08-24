import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { api } from '../api';
import type { RootStackParamList } from '../navigation';
import { money } from '../money';
import { radius, space, theme, weight } from '../theme';
import { EmptyState, Segmented, Skeleton } from '../ui';
import { artFor, visibleGames, type GameCategory, type GameDef } from '../games';

/**
 * Games — the catalogue screen, ported from `frontend/src/pages/Games.tsx`.
 *
 * THE GATE — this must iterate `visibleGames()`, never the raw `GAMES` array.
 * The launch gate (`HIDDEN_GAMES`, withheld on Victor's instruction) lives
 * inside that filter. An audit previously caught this exact page bypassing
 * the gate on the web and rendering withheld games as tappable tiles that
 * navigated to real tables — do not reintroduce that here.
 *
 * FIGURES — table counts and jackpots are live values from GET /lobby/games,
 * keyed by game id. There is nothing to fall back to when the lobby hasn't
 * answered yet: a tile shows an em dash for tables and no jackpot line at
 * all, never a zero — a zero is a claim about the pools, and it would be the
 * wrong one.
 *
 * NAVIGATION — the web pushes `/table/${g.id}`, where the game's own id
 * doubles as a table-server "slug" that opens that game's default table (see
 * `frontend/src/config.ts`'s `LIVE_TABLE_IDS`/`isOpenableTableId`). The
 * mobile `Table` stack screen takes the same shape of parameter
 * (`{ tableId: string }`), so a tap here mirrors that call: `navigate('Table',
 * { tableId: game.id })`. There is no mobile equivalent of a lobby "filtered
 * to one game" route, and inventing one is out of scope for this screen.
 */

type Filter = 'all' | GameCategory;

const COMING_SOON = ['blackjack', 'sicbo', 'fishingWar', 'setteMezzo'];

interface GameSummary {
  gameId: string;
  tables: number;
  /** micro-USD */
  jackpot: number;
}

interface LobbyGames {
  games: GameSummary[];
  /** micro-USD */
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
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  // Null, not a formatted zero, while the lobby is still answering — a zero
  // jackpot is a claim about the pools, and it is the wrong one.
  const jackpot = lobby.data ? money(lobby.data.totalJackpot, { decimals: 2 }) : null;

  // Live figures per game, keyed by id. The tiles take their table count and
  // jackpot from here; nothing on this screen comes from the static catalog
  // except artwork, names and categories.
  const live = useMemo(
    () => new Map((lobby.data?.games ?? []).map((g) => [g.gameId, g])),
    [lobby.data],
  );

  const query = q.trim().toLowerCase();

  // visibleGames(), NOT GAMES: the launch gate (HIDDEN_GAMES, withheld on
  // Victor's instruction) lives in that filter, and iterating the raw list
  // here rendered withheld games as tappable tiles that navigated to real
  // tables. An audit caught this page as the one map site bypassing the gate.
  const games = visibleGames();
  const grouped = {
    poker: games.filter((g) => g.category === 'poker'),
    card: games.filter((g) => g.category === 'card'),
    quick: games.filter((g) => g.category === 'quick' || g.category === 'arcade'),
  };

  const getShown = (list: GameDef[]) =>
    list.filter((g) => {
      const inCat = cat === 'all' || g.category === cat;
      const localised = t(`gameNames.${g.id}`, { defaultValue: g.name }).toLowerCase();
      const inQuery = !query || g.name.toLowerCase().includes(query) || localised.includes(query);
      return inCat && inQuery;
    });

  const openGame = (id: string) => navigation.navigate('Table', { tableId: id });

  const sections: { key: string; title: string; list: GameDef[] }[] = [
    { key: 'poker', title: t('games.sectionPoker'), list: getShown(grouped.poker) },
    { key: 'card', title: t('games.sectionCard'), list: getShown(grouped.card) },
    { key: 'quick', title: t('games.sectionQuick'), list: getShown(grouped.quick) },
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Search */}
      <View style={styles.search}>
        <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={theme.dim} strokeWidth={2} strokeLinecap="round">
          <Circle cx={11} cy={11} r={7} />
          <Path d="M21 21l-4.3-4.3" />
        </Svg>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t('games.searchPlaceholder')}
          placeholderTextColor={theme.dim}
          style={styles.searchInput}
        />
      </View>

      {/* Jackpot hero */}
      <View style={styles.hero}>
        <LinearGradient
          colors={[theme.brand, theme.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.heroBody}>
          <Text style={styles.heroLabel}>{t('jackpot.tier.GRAND')}</Text>
          {lobby.isPending ? (
            <View style={styles.heroSkeletonWrap}>
              <Skeleton width={180} />
            </View>
          ) : (
            <Text style={styles.heroValue}>
              {/* Em dash when the lobby failed — a hero that renders empty
                  looks broken, and a formatted zero would claim there is
                  nothing to win. Unknown is neither. */}
              {jackpot ?? '—'}
            </Text>
          )}
        </View>
      </View>

      <Segmented
        value={cat}
        onChange={setCat}
        options={[
          { value: 'all', label: t('games.filterAll').toUpperCase() },
          { value: 'poker', label: t('games.filter.poker').toUpperCase() },
          { value: 'card', label: t('games.filter.card').toUpperCase() },
          { value: 'arcade', label: t('games.filter.arcade').toUpperCase() },
          { value: 'quick', label: t('games.filter.quick').toUpperCase() },
        ]}
      />

      {/* Game sections */}
      <View style={styles.sections}>
        {sections.map(
          (section) =>
            section.list.length > 0 && (
              <View key={section.key} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
                <View style={styles.grid}>
                  {section.list.map((g) => (
                    <GameTile
                      key={g.id}
                      game={g}
                      tables={live.get(g.id)?.tables}
                      jackpot={live.get(g.id)?.jackpot}
                      onPress={() => openGame(g.id)}
                    />
                  ))}
                </View>
              </View>
            ),
        )}

        {getShown(games).length === 0 && (
          <EmptyState title={t('games.noMatch', { query: q })} />
        )}
      </View>

      {/* Coming soon */}
      <View style={styles.comingSoon}>
        <Text style={styles.comingSoonTitle}>{t('games.comingSoon')}</Text>
        <View style={styles.comingSoonGrid}>
          {COMING_SOON.map((id) => (
            <View key={id} style={styles.comingSoonCard}>
              <Text style={styles.comingSoonName}>{t(`gameNames.${id}`)}</Text>
              <View style={styles.soonBadge}>
                <Text style={styles.soonBadgeText}>{t('games.soonBadge')}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * One game tile, mirroring `frontend/src/components/GameTile.tsx`: sized by
 * aspect ratio (never a fixed height) so every card in the grid is identical
 * regardless of how long its name is or whether its figures have loaded.
 */
const TILE_RATIO = 6 / 7;

function GameTile({
  game,
  tables,
  jackpot,
  onPress,
}: {
  game: GameDef;
  tables?: number;
  jackpot?: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const art = artFor(game.image);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
    >
      <LinearGradient
        colors={game.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.tileArt}>
        {art ? (
          <Image source={art} style={styles.tileImage} resizeMode="contain" />
        ) : (
          <Text style={styles.tileGlyph}>{game.glyph}</Text>
        )}
      </View>
      <Text style={styles.tileName} numberOfLines={1}>
        {t(`gameNames.${game.id}`, { defaultValue: game.name })}
      </Text>
      <Text style={styles.tileTables}>
        {tables === undefined ? '—' : t('games.tableCount', { count: tables })}
      </Text>
      {/* The gold figure is this game's pooled jackpot across its tables. Shown
          only when there is one — a formatted zero on every card is noise, and
          on a game with no pool it would be a promise of nothing. */}
      {jackpot !== undefined && jackpot > 0 && (
        <Text style={styles.tileJackpot}>{money(jackpot, { decimals: 2 })}</Text>
      )}
    </Pressable>
  );
}

const GRID_GAP = space.sm;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: space.lg, gap: space.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  searchInput: { flex: 1, color: theme.text, fontSize: 14, fontFamily: weight('400') },
  hero: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
    height: 128,
    justifyContent: 'center',
  },
  heroBody: { alignItems: 'center', gap: 2, paddingHorizontal: space.lg },
  heroLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1, fontFamily: weight('800') },
  heroSkeletonWrap: { marginTop: space.sm },
  heroValue: {
    marginTop: 2,
    color: theme.jackpot,
    fontSize: 35,
    letterSpacing: -0.5, fontFamily: weight('900') },
  sections: { gap: space.xl },
  section: { gap: space.sm },
  sectionTitle: { color: theme.text, fontSize: 12, letterSpacing: 1, fontFamily: weight('800') },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  tile: {
    width: `${(100 - 2 * (GRID_GAP / 3.4)) / 3}%`,
    aspectRatio: TILE_RATIO,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  tilePressed: { opacity: 0.85 },
  tileArt: { height: 40, width: '100%', alignItems: 'center', justifyContent: 'center' },
  tileImage: { height: '100%', width: '100%' },
  tileGlyph: { fontSize: 30, lineHeight: 34, fontFamily: weight('400') },
  tileName: { width: '100%', textAlign: 'center', color: theme.text, fontSize: 11.5, fontFamily: weight('700') },
  tileTables: { color: theme.dim, fontSize: 9.5, fontFamily: weight('400') },
  tileJackpot: { color: theme.jackpot, fontSize: 10, fontFamily: weight('800') },
  comingSoon: { marginTop: space.xs, gap: space.sm },
  comingSoonTitle: { color: theme.dim, fontSize: 13, fontFamily: weight('700') },
  comingSoonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  comingSoonCard: {
    width: `${(100 - space.md / 3.6) / 2}%`,
    height: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.border,
    backgroundColor: theme.surface,
    opacity: 0.7,
    paddingHorizontal: space.md,
  },
  comingSoonName: { color: theme.dim, fontSize: 13, fontFamily: weight('600') },
  soonBadge: {
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  soonBadgeText: { color: theme.dim, fontSize: 9, fontFamily: weight('800') },
});
