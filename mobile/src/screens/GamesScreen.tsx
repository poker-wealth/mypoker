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
  ImageBackground,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Svg, Path, Circle } from 'react-native-svg';
import { api } from '../api';
import type { RootStackParamList } from '../navigation';
import { money } from '../money';
import { radius, space, theme, weight } from '../theme';
import { Badge, Card, Dialog, EmptyState, ListRow, Screen, Segmented, Sheet, Skeleton } from '../ui';
import { artFor, visibleGames, type GameCategory, type GameDef } from '../games';
import { CreateTableSheet } from '../components/CreateTableSheet';

type Filter = 'all' | GameCategory;

const COMING_SOON = ['blackjack', 'sicbo', 'fishingWar', 'setteMezzo'];

interface GameSummary {
  gameId: string;
  tables: number;
  jackpot: number;
}

interface LobbyGames {
  games: GameSummary[];
  totalJackpot: number;
}

export function GamesScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [cat, setCat] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [actionGame, setActionGame] = useState<GameDef | null>(null);
  const [createSheetGame, setCreateSheetGame] = useState<GameDef | null>(null);

  const lobby = useQuery({
    queryKey: ['lobby', 'games'],
    queryFn: () => api.get<LobbyGames>('/lobby/games'),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const jackpot = lobby.data ? lobby.data.totalJackpot : null;

  const live = useMemo(
    () => new Map((lobby.data?.games ?? []).map((g) => [g.gameId, g])),
    [lobby.data],
  );

  const query = q.trim().toLowerCase();

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
    <>
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
            placeholder="Search games"
            placeholderTextColor={theme.dim}
            style={styles.searchInput}
          />
        </View>

        {/* Jackpot Hero */}
        <View style={styles.hero}>
          <LinearGradient
            colors={['#C9A15F', '#E8C98E', '#B38B4A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Image source={require('../../assets/brand/trophy.png')} style={styles.trophy} resizeMode="contain" />
          <View style={styles.heroRight}>
            <Text style={styles.heroLabel}>GRAND JACKPOT</Text>
            {lobby.isPending ? (
              <Skeleton width={100} />
            ) : (
              <Text style={styles.heroValue}>
                {money(jackpot ?? 0, { decimals: 0 })}
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
                        onPress={() => setActionGame(g)}
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

      {/* Game Action Drawer (Screenshot 1) */}
      <Dialog
        open={actionGame !== null}
        onClose={() => setActionGame(null)}
        title={actionGame ? t(`gameNames.${actionGame.id}`, { defaultValue: actionGame.name }) : ''}
      >
        <View style={{ gap: space.sm }}>
          <Pressable
            style={styles.actionCard}
            onPress={() => {
              if (actionGame) {
                openGame(actionGame.id);
                setActionGame(null);
              }
            }}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: '#2A2A2A' }]}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#D9B87C" strokeWidth={2}>
                <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <Circle cx="9" cy="7" r="4" />
                <Path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </Svg>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Join a table</Text>
              <Text style={styles.actionHint}>Take a seat at the open table.</Text>
            </View>
          </Pressable>

          <Pressable
            style={styles.actionCard}
            onPress={() => {
              const g = actionGame;
              setActionGame(null);
              setTimeout(() => setCreateSheetGame(g), 100);
            }}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: '#2A2A2A' }]}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#D9B87C" strokeWidth={2}>
                <Path d="M12 5v14M5 12h14" />
              </Svg>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Create a table</Text>
              <Text style={styles.actionHint}>Open your own and invite friends.</Text>
            </View>
          </Pressable>
        </View>
      </Dialog>

      {/* Custom CreateTableSheet (Screenshot 2) */}
      <CreateTableSheet
        initialVariant={createSheetGame?.id as any}
        open={createSheetGame !== null}
        onClose={() => setCreateSheetGame(null)}
      />
    </>
  );
}

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
      {jackpot !== undefined && jackpot > 0 && (
        <Text style={styles.tileJackpot}>{money(jackpot, { decimals: 2 })}</Text>
      )}
    </Pressable>
  );
}

const GRID_GAP = space.sm;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: space.lg, paddingTop: space.md, gap: space.xl },
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
    height: 140,
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  trophy: {
    position: 'absolute',
    left: -20,
    bottom: -10,
    width: 180,
    height: 180,
  },
  heroRight: {
    flex: 1,
    alignItems: 'center',
    marginLeft: 100,
  },
  heroLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontFamily: weight('800'), letterSpacing: 0.5 },
  heroValue: { color: '#FFD700', fontSize: 38, fontFamily: weight('900'), textShadowColor: 'rgba(0,0,0,0.2)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 },

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
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    backgroundColor: theme.surface,
    borderRadius: radius.card,
    borderColor: theme.border,
    borderWidth: 1,
  },
  actionIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(187,92,246,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: {
    color: theme.text,
    fontSize: 16,
    fontFamily: weight('700'),
  },
  actionHint: {
    color: theme.dim,
    fontSize: 12,
    marginTop: 2,
    fontFamily: weight('400'),
  },
});
