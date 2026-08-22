import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Sheet } from '../../ui';
import { TABLE_DESIGNS, type TableDesign } from '../../table/tableDesigns';
import { useTableDesign } from '../../table/tableDesignStore';
import { radius, space, theme } from '../../theme';

/**
 * Pick a table.
 *
 * Ported from `frontend/src/components/poker/TableDesignSheet.tsx`. Each option shows the actual
 * felt rather than a swatch — the whole reason to offer a choice is how the table looks, so the
 * choice is made by looking at it. The pick is saved, so the felt you chose is the one waiting next
 * time you sit down.
 */
export function TableDesignSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { id: current, setDesign } = useTableDesign();

  return (
    <Sheet open={open} onClose={onClose} title="Table design">
      <View style={styles.grid}>
        {TABLE_DESIGNS.map((design) => (
          <Pressable
            key={design.id}
            onPress={() => {
              setDesign(design.id);
              onClose();
            }}
            style={[styles.option, design.id === current && styles.optionOn]}
          >
            <View style={styles.thumbFrame}>
              <DesignThumb design={design} />
              {design.id === current ? (
                <View style={styles.tick}>
                  <Text style={styles.tickMark}>✓</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.name}>{design.name}</Text>
            <Text style={styles.blurb}>{design.blurb}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.footnote}>
        Only the felt changes — the seats, the cards and the hand stay exactly where they are.
      </Text>
    </Sheet>
  );
}

/** A small likeness of the table: the artwork itself, or a miniature of the drawn felt. */
function DesignThumb({ design }: { design: TableDesign }) {
  if (design.art) {
    return <Image source={design.art} resizeMode="contain" style={styles.thumbArt} />;
  }
  return (
    <View
      style={[
        styles.thumbDrawn,
        { aspectRatio: design.aspect, borderColor: design.accent },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  option: {
    // Two per row, accounting for the gap and the row's padding.
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: space.sm,
  },
  optionOn: { borderColor: theme.brand, backgroundColor: theme.surface2 },
  thumbFrame: {
    height: 112,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbArt: { width: '100%', height: '100%' },
  thumbDrawn: {
    height: '92%',
    borderRadius: 999,
    borderWidth: 2,
    backgroundColor: '#12294d',
  },
  tick: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: theme.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickMark: { color: '#fff', fontSize: 12, fontWeight: '900' },
  name: { marginTop: space.sm, color: theme.text, fontSize: 13, fontWeight: '700' },
  blurb: { color: theme.dim, fontSize: 11, lineHeight: 15 },
  footnote: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    textAlign: 'center',
    color: theme.dim,
    fontSize: 11,
  },
});
