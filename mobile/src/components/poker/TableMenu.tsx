import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { space, theme, weight } from '../../theme';

/**
 * The table's menu drawer — the native twin of
 * `frontend/src/components/poker/TableMenu.tsx`.
 *
 * ALL THE SAME ROWS, in the same order, with the same rules about what is
 * disabled and why. The two clients are one product; a player who learns the
 * menu on their phone must find it unchanged in Telegram.
 *
 * Stand up and Sit out stay SEPARATE rows. Stand up gives the seat up and keeps
 * you watching; Sit out keeps the seat and skips hands. Collapsing them would
 * hide a choice that costs a player their seat.
 *
 * Store has no backend at all, and Hand Rankings has no chart on this client
 * yet — both are drawn with a readable reason rather than greyed in silence,
 * because a control that looks live and does nothing is worse than one that
 * explains itself.
 *
 * A `Modal` rather than an absolutely-positioned View: React Native has no
 * z-index across siblings the way the web does, and the felt below would
 * otherwise stay tappable behind an open drawer.
 */
export interface TableMenuProps {
  open: boolean;
  onClose: () => void;
  onShare: () => void;
  /** Absent when not seated. */
  onStandUp?: () => void;
  onRankings?: () => void;
  onOptions: () => void;
  /** Absent when not seated. */
  onBuyIn?: () => void;
  /** Absent when not seated. */
  onSitOut?: () => void;
  onFairness?: () => void;
  onExit: () => void;
}

export function TableMenu({
  open,
  onClose,
  onShare,
  onStandUp,
  onRankings,
  onOptions,
  onBuyIn,
  onSitOut,
  onFairness,
  onExit,
}: TableMenuProps) {
  const { t } = useTranslation();
  /*
   * SAFE AREA. This drawer starts at y=0, so without the top inset its first
   * row sits UNDER the status bar — the table id and the clock were being
   * covered by the carrier and battery icons. The inset is applied to the
   * panel rather than baked into the header padding because it is a property
   * of the device, not of the design: a phone with no notch adds nothing.
   */
  const insets = useSafeAreaInsets();

  // Close first: each of these opens something else, and two sheets stacked in
  // one context leaves the one underneath visible and tappable.
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      {/*
        An EXPLICIT full-screen row, rather than relying on absolute positioning
        inside the Modal.

        `position: absolute` needs a positioned ancestor to mean anything, and a
        Modal's own container is not one you can count on — the drawer ended up
        floating in the middle of the screen instead of pinned to the left edge.
        A flex row with `alignItems: flex-start` puts it hard against the left
        and lets it take only the height its rows need, which is what the
        reference does.
      */}
      <View style={styles.sheet}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.drawer, { paddingTop: insets.top }]}>
        <Text style={styles.title}>{t('table.menuTitle')}</Text>
        <ScrollView bounces={false}>
          <Row label={t('table.menuShare')} onPress={act(onShare)} />
          <Row
            label={t('table.menuStandUp')}
            {...(onStandUp ? { onPress: act(onStandUp) } : {})}
          />
          <Row
            label={t('table.menuRankings')}
            {...(onRankings ? { onPress: act(onRankings) } : { reason: t('table.menuSoon') })}
          />
          <Row label={t('table.menuOptions')} onPress={act(onOptions)} chevron />
          <Row
            label={t('table.rebuy')}
            {...(onBuyIn ? { onPress: act(onBuyIn) } : {})}
            chevron
          />
          <Row
            label={t('table.sitOut')}
            {...(onSitOut ? { onPress: act(onSitOut) } : {})}
          />
          {/* No store exists — no catalogue, no purchase path, no backend. */}
          <Row label={t('table.menuStore')} reason={t('table.menuSoon')} chevron />
          {onFairness ? <Row label={t('table.fairness')} onPress={act(onFairness)} /> : null}
          <Row label={t('table.menuExit')} onPress={act(onExit)} danger />
        </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Row({
  label,
  onPress,
  reason,
  chevron,
  danger,
}: {
  label: string;
  onPress?: () => void;
  /** Why this row cannot be used. Renders it disabled, with the reason beside it. */
  reason?: string;
  chevron?: boolean;
  danger?: boolean;
}) {
  const disabled = !onPress;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, pressed && !disabled && styles.rowPressed]}
    >
      <Text
        style={[styles.rowText, danger && styles.rowDanger, disabled && styles.rowDisabled]}
        numberOfLines={2}
      >
        {label}
      </Text>
      {reason ? <Text style={styles.reason}>{reason}</Text> : null}
      {/* Drawn even when the row is disabled, as the reference has it: the
          chevron says "this leads somewhere", which stays true of a row you
          cannot use yet. The row's own dimming is what says it is unavailable. */}
      {chevron ? (
        <Text style={[styles.chevron, disabled && styles.rowDisabled]}>›</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  drawer: {
    // Wide enough that "Poker Hand Rankings" is not truncated at 16px: 47%
    // of a 414pt screen leaves ~163pt of text column, which cut it off.
    width: '58%',
    maxWidth: 260,
    maxHeight: '88%',
    borderBottomRightRadius: 0,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.border,
    // Near-black with a little of the table showing through, as the reference
    // has it. `theme.surface` is the app's card grey and read as a panel bolted
    // over the felt rather than a drawer cut into it.
    backgroundColor: 'rgba(20,18,19,0.97)',
    paddingBottom: space.sm,
  },
  title: {
    color: theme.brand,
    fontSize: 15,
    letterSpacing: 0,
    fontFamily: weight('700'),
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: 17,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  rowPressed: { backgroundColor: theme.surface2 },
  rowText: { flex: 1, color: theme.text, fontSize: 16 },
  rowDanger: { color: theme.danger },
  rowDisabled: { color: theme.dim, opacity: 0.6 },
  reason: { color: theme.dim, fontSize: 10 },
  chevron: { color: theme.dim, fontSize: 24, lineHeight: 24 },
});
