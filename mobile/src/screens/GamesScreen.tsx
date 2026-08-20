import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { TABLES_URL, PORTED_TABLES } from '../config';
import { useNav } from '../navigation';

/**
 * The Games screen: the jackpot hero, then tiles by category.
 *
 * Ported from `frontend/src/pages/Games.tsx`, including the rule that matters most there — the
 * tiles come from the LIVE table list, not a hardcoded catalogue, so a game added on the server
 * appears without a client release. A tile whose felt has not been ported yet is shown but dimmed
 * and unopenable, rather than opening a blank screen.
 */

interface TableRow {
  tableId: string;
  name: string;
  variant: string;
  seated: number;
  maxSeats: number;
  phase: string;
}

/** Category per table id, mirroring the web catalogue's grouping. */
const CATEGORY: Record<string, 'poker' | 'card' | 'quick'> = {
  texas: 'poker',
  'texas-high': 'poker',
  'short-deck': 'poker',
  omaha: 'poker',
  'dou-di-zhu': 'card',
  'niu-niu': 'card',
  'san-zhang': 'card',
  baccarat: 'card',
  'red-packet': 'quick',
  slots: 'quick',
  'cowboy-beauty': 'quick',
  lottery: 'quick',
  'texas-cowboy': 'quick',
};

const GLYPH: Record<string, string> = {
  texas: '♠',
  'texas-high': '♠',
  'short-deck': '♦',
  omaha: '♥',
  'dou-di-zhu': '👑',
  'niu-niu': '🐮',
  'san-zhang': '🃏',
  baccarat: '🎴',
  'red-packet': '🧧',
  slots: '🎰',
  'cowboy-beauty': '🤠',
  lottery: '🎟',
  'texas-cowboy': '🤠',
};

const SECTIONS: { key: 'poker' | 'card' | 'quick'; label: string }[] = [
  { key: 'poker', label: 'POKER GAMES' },
  { key: 'card', label: 'CARD GAMES' },
  { key: 'quick', label: 'QUICK GAMES' },
];

export function GamesScreen() {
  const { openTable } = useNav();
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${TABLES_URL}/api/live/tables`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { tables: TableRow[] }) => {
        if (!cancelled) setTables(body.tables ?? []);
      })
      .catch((err: unknown) => {
        // Name the address: on a phone this almost always means the URL points at the device
        // rather than the dev machine.
        if (!cancelled) setError(`Could not reach ${TABLES_URL} — ${String(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* The jackpot hero. The figure is an em dash until the lobby API is wired: "$ 0.00" would
          be a claim about the pools, and it would be the wrong one. */}
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>GRAND JACKPOT</Text>
        <Text style={styles.heroValue}>—</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      {!tables && !error && <Text style={styles.dim}>Loading games…</Text>}

      {tables &&
        SECTIONS.map(({ key, label }) => {
          const rows = tables.filter((t) => (CATEGORY[t.tableId] ?? 'quick') === key);
          if (rows.length === 0) return null;
          return (
            <View key={key} style={styles.section}>
              <Text style={styles.sectionTitle}>{label}</Text>
              <View style={styles.grid}>
                {rows.map((t) => {
                  const ported = PORTED_TABLES.has(t.tableId);
                  return (
                    <Pressable
                      key={t.tableId}
                      disabled={!ported}
                      onPress={() => openTable({ tableId: t.tableId, name: t.name })}
                      style={({ pressed }) => [
                        styles.tile,
                        !ported && styles.tileDim,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.glyph}>{GLYPH[t.tableId] ?? '🎲'}</Text>
                      <Text style={styles.tileName} numberOfLines={1}>
                        {t.variant}
                      </Text>
                      <Text style={styles.tileMeta}>
                        {ported ? `${t.seated}/${t.maxSeats} seated` : 'no felt yet'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  hero: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.brand2,
    paddingVertical: 20,
    alignItems: 'center',
  },
  heroLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  heroValue: { color: colors.gold, fontSize: 34, fontWeight: '900', marginTop: 2 },
  section: { gap: 8 },
  sectionTitle: { color: colors.text, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '31.5%',
    aspectRatio: 0.95,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 6,
  },
  tileDim: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
  glyph: { fontSize: 26 },
  tileName: { color: colors.text, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  tileMeta: { color: colors.dim, fontSize: 9, textAlign: 'center' },
  dim: { color: colors.dim, fontSize: 12 },
  error: { color: colors.danger, fontSize: 12 },
});
