import * as React from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch as RNSwitch,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { radius, space, theme, weight } from './theme';

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
  labelRight,
  value,
  hint,
  left,
  right,
  onPress,
}: {
  label: string;
  labelRight?: ReactNode;
  value?: string;
  hint?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.row}>
      {left}
      <View style={styles.rowMain}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.rowLabel, label === 'Dragon' && { fontFamily: weight('700'), fontSize: 16 }]}>{label}</Text>
          {labelRight}
        </View>
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
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  /**
   * Layout only, for the caller's row — never colour, which stays with `variant`.
   *
   * Added so buttons sharing a row can stretch to a common height. Without it each button sized to
   * its own label, so the lobby's two-line "CREATE PRIVATE TABLE" rendered visibly taller than the
   * "Quick join" beside it.
   */
  style?: ViewStyle;
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
        style,
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
  activeColor = theme.brand,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  activeColor?: string;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && { backgroundColor: activeColor }]}
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
      {/* On iOS the keyboard slides OVER a bottom-anchored Modal rather than resizing it —
          without this, a field like the withdrawal amount input ends up hidden behind the
          keyboard with no way to scroll it back into view. Android already resizes via
          `windowSoftInputMode="adjustResize"`, so `behavior` is undefined there; stacking
          RN's own padding on top of that resize would shift the sheet twice. */}
      <KeyboardAvoidingView
        style={styles.backdropWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          {title !== undefined && <Text style={styles.sheetTitle}>{title}</Text>}
          {/* Scrollable so content taller than the sheet — or pushed up by the keyboard —
              stays reachable; `keyboardShouldPersistTaps="handled"` so the first tap on a
              button in here (e.g. confirm) actually fires instead of just dismissing the
              keyboard. */}
          <ScrollView
            style={styles.sheetBody}
            contentContainerStyle={styles.sheetBodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

import Svg, { Circle, Path } from 'react-native-svg';

export function PokerChip({ disabled, size = 26 }: { disabled?: boolean; size?: number }) {
  const stripe = disabled ? theme.dim : '#d8453c';
  const pale = '#f5f2ea';
  const center = theme.surface2;
  const radius = size / 2;
  const cx = size / 2;
  const cy = size / 2;

  const wedges = [];
  for (let i = 0; i < 6; i++) {
    const angle = i * 60;
    const startAngle = (angle - 90) * (Math.PI / 180);
    const endAngle = (angle + 24 - 90) * (Math.PI / 180);
    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    wedges.push(`M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`);
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.45,
        shadowRadius: 3,
        elevation: 2,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={cx} cy={cy} r={radius} fill={pale} />
        {wedges.map((d, i) => (
          <Path key={i} d={d} fill={stripe} />
        ))}
        <Circle cx={cx} cy={cy} r={radius * 0.64} fill={pale} stroke={stripe} strokeWidth={1.5} />
        <Circle cx={cx} cy={cy} r={radius * 0.24} fill={center} />
      </Svg>
    </View>
  );
}

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
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      style={{
        width: 50,
        height: 28,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.1)',
        padding: 2,
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ alignSelf: value ? 'flex-end' : 'flex-start' }}>
        <PokerChip disabled={!value} size={24} />
      </View>
    </Pressable>
  );
}

/** A value that is still loading. Never a zero — a zero is a claim. */
export function Skeleton({ width = 80 }: { width?: number }) {
  return <View style={[styles.skeleton, { width }]} />;
}

export function EmptyState({ title, body, icon }: { title: string; body?: string; icon?: ReactNode }) {
  return (
    <View style={styles.state}>
      {icon && <View style={{ marginBottom: 8 }}>{icon}</View>}
      <Text style={[styles.stateTitle, { fontSize: 16 }]}>{title}</Text>
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
  header,
  children,
}: {
  query: { data?: T; isPending: boolean; isError: boolean; error?: unknown; refetch: () => void };
  empty?: { when: (data: T) => boolean; title: string; body?: string };
  errorLabel: { retry: string; fallback: string };
  /**
   * Rendered above the query's own state, and therefore still there while it
   * is pending, empty or errored.
   *
   * For controls that CHANGE the query — a tab strip, a period switch. Those
   * live outside the result by necessity: put a tab strip inside `children`
   * and switching to a tab that happens to be empty replaces the strip with
   * the empty state, so the reader has no way back to the other tabs. A
   * control that disappears exactly when you need it is TRAPS §12.
   */
  header?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {header}

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
  rowLabel: { color: theme.text, fontSize: 14, fontFamily: weight('400') },
  rowHint: { color: theme.dim, fontSize: 11, fontFamily: weight('400') },
  rowValue: { color: theme.dim, fontSize: 13, maxWidth: '50%', fontFamily: weight('400') },
  pressed: { opacity: 0.6 },
  badge: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, textTransform: 'uppercase', fontFamily: weight('800') },
  button: {
    alignItems: 'center',
    // Centred vertically and given a floor, so buttons in a row read as the same control even
    // when one label runs to two lines.
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  buttonText: { fontSize: 14, fontFamily: weight('700') },
  dim: { opacity: 0.55 },
  skeleton: { backgroundColor: theme.surface2, borderRadius: 6, height: 14 },
  state: { alignItems: 'center', gap: space.xs, paddingVertical: space.xl },
  stateTitle: { color: theme.text, fontSize: 15, fontFamily: weight('700') },
  stateBody: { color: theme.dim, fontSize: 12, textAlign: 'center', fontFamily: weight('400') },
  errorBox: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.sm,
  },
  errorText: { color: theme.text, fontSize: 13, lineHeight: 19, fontFamily: weight('400') },
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
  segmentActive: { backgroundColor: theme.brand },
  segmentText: { color: theme.dim, fontSize: 12, fontFamily: weight('700') },
  segmentTextActive: { color: theme.bg },
  backdropWrap: { flex: 1 },
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
    textAlign: 'center',
    paddingBottom: space.sm,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    fontFamily: weight('700'),
  },
  // `flexShrink` (not `flex: 1`) so the ScrollView sizes to its content, shrinking to fit
  // under `sheet`'s maxHeight only when the content — or the keyboard — demands it, rather
  // than always stretching to fill it.
  sheetBody: { flexShrink: 1 },
  sheetBodyContent: { padding: space.lg, gap: space.md },
  dialogCenter: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.lg,
    pointerEvents: 'box-none',
  },
  dialog: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    width: '100%',
    maxWidth: 400,
    maxHeight: '85%',
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.md,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  dialogTitle: {
    color: theme.text,
    fontSize: 16,
    fontFamily: weight('700'),
  },
  dialogClose: {
    padding: space.xs,
  },
  dialogBody: { flexShrink: 1 },
  dialogBodyContent: { padding: space.lg, gap: space.md },
});

export function Dialog({
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
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdropWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.dialogCenter}>
          <View style={styles.dialog}>
            <View style={styles.dialogHeader}>
              {title !== undefined && <Text style={styles.dialogTitle}>{title}</Text>}
              <Pressable onPress={onClose} style={styles.dialogClose}>
                <Text style={{ color: theme.dim, fontSize: 16, fontFamily: weight('600') }}>✕</Text>
              </Pressable>
            </View>
            <ScrollView
              style={styles.dialogBody}
              contentContainerStyle={styles.dialogBodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}



export function DiscreteSlider<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (val: T) => void;
  disabled?: boolean;
}) {
  const [width, setWidth] = React.useState(1);
  const valRef = React.useRef(value);
  valRef.current = value;

  const panResponder = React.useMemo(() => {
    const handleTouch = (x: number, w: number) => {
      if (disabled || w <= 1) return;
      const padding = 24; // 8 padding + 16 half node
      const usableWidth = w - padding * 2;
      const pct = (x - padding) / usableWidth;
      let idx = Math.round(pct * (options.length - 1));
      idx = Math.max(0, Math.min(idx, options.length - 1));
      const nextVal = options[idx].value;
      if (nextVal !== valRef.current) {
        valRef.current = nextVal;
        onChange(nextVal);
      }
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => handleTouch(evt.nativeEvent.locationX, width),
      onPanResponderMove: (evt) => handleTouch(evt.nativeEvent.locationX, width),
    });
  }, [disabled, width, options, onChange]);

  return (
    <View 
      style={sliderStyles.container} 
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      {...panResponder.panHandlers}
    >
      <View style={sliderStyles.line} />
      {options.map((opt, i) => {
        const isActive = opt.value === value;
        return (
          <View
            key={String(opt.value)}
            style={sliderStyles.nodeContainer}
          >
            <Text
              style={[
                sliderStyles.label,
                isActive && sliderStyles.labelActive,
                disabled && sliderStyles.labelDisabled,
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
            <View style={sliderStyles.nodeWrapper}>
              {isActive ? (
                <PokerChip disabled={disabled} size={24} />
              ) : (
                <View style={[sliderStyles.dot, disabled && sliderStyles.dotDisabled]} />
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 48,
    position: 'relative',
    paddingHorizontal: 8,
  },
  line: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 11,
    height: 2,
    backgroundColor: theme.surface2,
  },
  nodeContainer: {
    alignItems: 'center',
    gap: 8,
    width: 32,
    pointerEvents: 'none', // let panresponder handle taps
  },
  label: {
    color: theme.dim,
    fontSize: 10,
    fontFamily: weight('600'),
    textAlign: 'center',
  },
  labelActive: {
    color: 'white',
    fontFamily: weight('800'),
  },
  labelDisabled: {
    opacity: 0.5,
  },
  nodeWrapper: {
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.dim,
  },
  dotDisabled: {
    opacity: 0.3,
  },
});

export function ToggleRow({
  label,
  hint,
  caption,
  checked,
  onChange,
  soonLabel,
}: {
  label: string;
  hint?: string;
  caption?: string;
  checked: boolean;
  onChange: (val: boolean) => void;
  soonLabel?: string;
}) {
  const disabled = soonLabel !== undefined;
  return (
    <View style={toggleRowStyles.container}>
      <View style={toggleRowStyles.textContainer}>
        <View style={toggleRowStyles.labelRow}>
          <Text style={[toggleRowStyles.label, disabled && { opacity: 0.5 }]}>{label}</Text>
          {soonLabel && <Badge tone="neutral">{soonLabel}</Badge>}
        </View>
        {hint !== undefined && <Text style={toggleRowStyles.hint}>{hint}</Text>}
        {caption !== undefined && <Text style={toggleRowStyles.caption}>{caption}</Text>}
      </View>
      <Toggle value={checked} onChange={onChange} disabled={disabled} />
    </View>
  );
}

const toggleRowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  textContainer: {
    flex: 1,
    paddingRight: 16,
    gap: 4,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    color: theme.text,
    fontSize: 14,
    fontFamily: weight('600'),
  },
  hint: {
    color: theme.dim,
    fontSize: 11,
    fontFamily: weight('400'),
  },
  caption: {
    color: theme.brand,
    fontSize: 11,
    fontFamily: weight('400'),
  },
});

export function DiscreteRangeSlider<T extends string | number>({
  options,
  low,
  high,
  onChange,
  disabled,
}: {
  options: { value: T; label: string }[];
  low: T;
  high: T;
  onChange: (lo: T, hi: T) => void;
  disabled?: boolean;
}) {
  const [width, setWidth] = React.useState(1);
  const lowIdx = Math.max(0, options.findIndex((o) => o.value === low));
  const highIdx = Math.max(0, options.findIndex((o) => o.value === high));
  const n = Math.max(1, options.length - 1);

  const lowRef = React.useRef(lowIdx);
  const highRef = React.useRef(highIdx);
  lowRef.current = lowIdx;
  highRef.current = highIdx;
  const activeThumb = React.useRef<'low' | 'high' | null>(null);

  const panResponder = React.useMemo(() => {
    const handleTouch = (x: number, w: number, isGrant: boolean) => {
      if (disabled || w <= 1) return;
      const padding = 24;
      const usableWidth = w - padding * 2;
      const pct = (x - padding) / usableWidth;
      let idx = Math.round(pct * (options.length - 1));
      idx = Math.max(0, Math.min(idx, options.length - 1));

      if (isGrant) {
        if (Math.abs(idx - lowRef.current) < Math.abs(idx - highRef.current)) {
          activeThumb.current = 'low';
        } else {
          activeThumb.current = 'high';
        }
      }

      let nextLow = lowRef.current;
      let nextHigh = highRef.current;
      if (activeThumb.current === 'low') {
        nextLow = Math.min(idx, nextHigh); // don't cross thumbs
      } else {
        nextHigh = Math.max(idx, nextLow);
      }

      if (nextLow !== lowRef.current || nextHigh !== highRef.current) {
        lowRef.current = nextLow;
        highRef.current = nextHigh;
        onChange(options[nextLow].value, options[nextHigh].value);
      }
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => handleTouch(evt.nativeEvent.locationX, width, true),
      onPanResponderMove: (evt) => handleTouch(evt.nativeEvent.locationX, width, false),
    });
  }, [disabled, width, options, onChange]);

  return (
    <View 
      style={sliderStyles.container}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      {...panResponder.panHandlers}
    >
      <View style={sliderStyles.line} />
      <View 
        style={[
          sliderStyles.line,
          { 
            backgroundColor: '#D4AF37', 
            left: `${(lowIdx / n) * 90 + 5}%`,
            right: `${100 - ((highIdx / n) * 90 + 5)}%`,
          }
        ]} 
      />
      {options.map((opt, i) => {
        const isLow = i === lowIdx;
        const isHigh = i === highIdx;
        const isActive = isLow || isHigh;
        const inRange = i >= lowIdx && i <= highIdx;

        return (
          <View key={String(opt.value)} style={sliderStyles.nodeContainer}>
            <Text
              style={[
                sliderStyles.label,
                inRange && sliderStyles.labelActive,
                disabled && sliderStyles.labelDisabled,
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
            <View style={sliderStyles.nodeWrapper}>
              {isActive ? (
                <PokerChip disabled={disabled} size={24} />
              ) : (
                <View
                  style={[
                    sliderStyles.dot,
                    inRange && { backgroundColor: '#D4AF37' },
                    disabled && sliderStyles.dotDisabled,
                  ]}
                />
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
