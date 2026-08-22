import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { GameDef } from '../lib/games';
import { money } from '../money';
import { radius, theme } from '../theme';

/**
 * One game card in the Games grid.
 *
 * Ported from `frontend/src/components/GameTile.tsx`.
 *
 * SHAPE — sized by ASPECT RATIO, never a fixed height. A ratio guarantees the thing the design
 * needs: every card in the grid is identical regardless of how long its name is or whether its
 * figures have loaded, because none of that can push the height around.
 *
 * FIGURES — `tables` and `jackpot` are live values from the lobby. There is deliberately nothing to
 * fall back to: when the lobby has not answered, the card shows a dash rather than a number. The
 * web version once read a hardcoded `players` field and showed the design document's invented
 * counts as live ones.
 */

/** width / height. 6:7 ≈ 0.857 — near-square, with room for three text rows. */
const TILE_RATIO = 6 / 7;

export interface GameTileProps {
  game: GameDef;
  /** Live table count. Undefined until the lobby answers. */
  tables?: number;
  /** Live pooled jackpot, micro-USD. */
  jackpot?: number;
  onPress?: () => void;
}

export function GameTile({ game, tables, jackpot, onPress }: GameTileProps) {
  const { t } = useTranslation();

  return (
    <Pressable onPress={onPress} style={styles.tile}>
      <View style={styles.art}>
        {game.image ? (
          <Image source={game.image} resizeMode="contain" style={styles.image} />
        ) : (
          <Text style={styles.glyph}>{game.glyph}</Text>
        )}
      </View>

      <Text style={styles.name} numberOfLines={1}>
        {t(`gameNames.${game.id}`, { defaultValue: game.name })}
      </Text>

      {/* A dash, not a zero. "0 tables" is a claim; unknown is not. */}
      <Text style={styles.tables}>
        {tables === undefined ? '—' : t('games.tableCount', { count: tables, defaultValue: `${tables} tables` })}
      </Text>

      {/* Gold, and only for a real pool. */}
      <Text style={styles.jackpot}>
        {jackpot === undefined || jackpot <= 0 ? ' ' : money(jackpot)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    aspectRatio: TILE_RATIO,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 10,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  art: { height: 40, width: '100%', alignItems: 'center', justifyContent: 'center' },
  image: { height: '100%', width: '100%' },
  glyph: { fontSize: 28 },
  name: { color: theme.text, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  tables: { color: theme.dim, fontSize: 10 },
  jackpot: { color: theme.jackpot, fontSize: 11, fontWeight: '800' },
});
