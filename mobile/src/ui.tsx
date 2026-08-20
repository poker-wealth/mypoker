import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch as RNSwitch,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { radius, space, theme } from './theme';

/**
 * The native primitives, mirroring `frontend/src/components/ui/`.
 *
 * Same names, same tones, same rules — so a ported screen reads like its web
 * original and a reviewer can diff them by eye. Two contracts are carried over
 * deliberately because they are the ones misremembered on the web side too:
 *
 *   Badge tones are brand | success | accent | neutral | warn. There is NO
 *   `danger` tone; `warn` already resolves to the danger colour.
 *
 *   Jackpot gold is for jackpots. Not chrome, not admin, not "this is
 *   important". It has crept back in twice on the web app.
 *
 * `Screen` bakes in the three states every fetching view must have — loading,
 * empty, error — because "an empty screen and a broken screen must not look
 * alike" is a rule that only holds if the easy path enforces it.
 */

type Tone = 'brand' | 'success' | 'accent' | 'neutral' | 'warn';

const TONE: Record<Tone, { bg: string; fg: string }> = {
  brand: { bg: 'rgba(187,92,246,0.16)', fg: theme.brand },
  success: { bg: 'rgba(63,208,122,0.16)', fg: theme.success },
  accent: { bg: 'rgba(0,212,255,0.16)', fg: theme.accent },
  warn: { bg: 'rgba(248,86,119,0.16)', fg: theme.danger },
  neutral: { bg: theme.surface2, fg: theme.dim },
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  const t = TONE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A tappable row. `onPress` absent renders it inert rather than fake-tappable. */
export function ListRow({
  label,
  value,
  hint,
  right,
  onPress,
}: {
  label: string;
  value?: string;
  hint?: string;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint !== undefined && <Text style={styles.rowHint}>{hint}</Text>}
      </View>
      {value !== undefined && (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      )}
      {right}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? styles.pressed : undefined)}>
      {body}
    </Pressable>
  );
}

export function Button({
  children,
  onPress,
  variant = 'primary',
  disabled,
}: {
  children: ReactNode;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
}) {
  const palette =
    variant === 'primary'
      ? { bg: theme.brand, fg: '#ffffff' }
      : variant === 'danger'
        ? { bg: 'rgba(248,86,119,0.16)', fg: theme.danger }
        : { bg: theme.surface2, fg: theme.text };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg },
        (pressed || disabled) && styles.dim,
      ]}
    >
      <Text style={[styles.buttonText, { color: palette.fg }]}>{children}</Text>
    </Pressable>
  );
}

/**
 * A segmented control — the tab bar inside a screen.
 *
 * Options carry their own labels already translated; this never sees a key, so
 * it cannot accidentally render one raw. Generic over the value so a caller
 * gets back the union it passed in, not a bare string.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A bottom sheet.
 *
 * `Modal` rather than an absolutely-positioned view, so it sits above
 * everything including the tab bar and takes the hardware back button on
 * Android — a sheet you cannot dismiss with Back is a trap on that platform.
 *
 * Dismissing by backdrop resolves as a CANCEL at the call site. For anything
 * touching money the safe answer to a question nobody answered is no.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        {title !== undefined && <Text style={styles.sheetTitle}>{title}</Text>}
        <View style={styles.sheetBody}>{children}</View>
      </View>
    </Modal>
  );
}

/**
 * An on/off control.
 *
 * RN ships its own `Switch`; this wraps it only to pin the brand colours in one
 * place, so a screen never hand-picks them. `value` is required — a switch that
 * renders before its state is known would show a confident OFF for something
 * that may be ON, which on a settings screen is a lie the user acts on.
 */
export function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <RNSwitch
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      trackColor={{ false: theme.surface2, true: theme.brand }}
      thumbColor={theme.text}
    />
  );
}

/** A value that is still loading. Never a zero — a zero is a claim. */
export function Skeleton({ width = 80 }: { width?: number }) {
  return <View style={[styles.skeleton, { width }]} />;
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.state}>
      <Text style={styles.stateTitle}>{title}</Text>
      {body !== undefined && <Text style={styles.stateBody}>{body}</Text>}
    </View>
  );
}

export function ErrorState({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel: string }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry && (
        <Button variant="ghost" onPress={onRetry}>
          {retryLabel}
        </Button>
      )}
    </View>
  );
}

/**
 * Wraps a fetching screen so the three states are the default, not a decision.
 *
 * `isEmpty` is a predicate rather than a flag so the caller cannot forget to
 * recompute it after a refetch.
 */
export function Screen<T>({
  query,
  empty,
  errorLabel,
  children,
}: {
  query: { data?: T; isPending: boolean; isError: boolean; error?: unknown; refetch: () => void };
  empty?: { when: (data: T) => boolean; title: string; body?: string };
  errorLabel: { retry: string; fallback: string };
  children: (data: T) => ReactNode;
}) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {query.isPending && <ActivityIndicator color={theme.brand} style={styles.pad} />}

      {query.isError && (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : errorLabel.fallback}
          onRetry={query.refetch}
          retryLabel={errorLabel.retry}
        />
      )}

      {query.data !== undefined &&
        (empty && empty.when(query.data) ? (
          <EmptyState title={empty.title} {...(empty.body !== undefined ? { body: empty.body } : {})} />
        ) : (
          children(query.data)
        ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  screenContent: { padding: space.lg, gap: space.md },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  rowMain: { flex: 1, gap: 2 },
  rowLabel: { color: theme.text, fontSize: 14 },
  rowHint: { color: theme.dim, fontSize: 11 },
  rowValue: { color: theme.dim, fontSize: 13, maxWidth: '50%' },
  pressed: { opacity: 0.6 },
  badge: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  button: {
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  buttonText: { fontSize: 14, fontWeight: '700' },
  dim: { opacity: 0.55 },
  skeleton: { backgroundColor: theme.surface2, borderRadius: 6, height: 14 },
  state: { alignItems: 'center', gap: space.xs, paddingVertical: space.xl },
  stateTitle: { color: theme.text, fontSize: 15, fontWeight: '700' },
  stateBody: { color: theme.dim, fontSize: 12, textAlign: 'center' },
  errorBox: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.sm,
  },
  errorText: { color: theme.text, fontSize: 13, lineHeight: 19 },
  pad: { alignSelf: 'flex-start', paddingVertical: space.md },
  segmented: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    padding: 3,
    gap: 3,
  },
  segment: { flex: 1, alignItems: 'center', borderRadius: radius.pill, paddingVertical: space.sm },
  segmentActive: { backgroundColor: theme.surface2 },
  segmentText: { color: theme.dim, fontSize: 12, fontWeight: '700' },
  segmentTextActive: { color: theme.text },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: theme.bg,
    borderTopColor: theme.border,
    borderTopWidth: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: space.xl,
    maxHeight: '85%',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: theme.border,
    marginVertical: space.sm,
  },
  sheetTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    paddingBottom: space.sm,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  sheetBody: { padding: space.lg, gap: space.md },
});
