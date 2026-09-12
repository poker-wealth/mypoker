import { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { radius, space, theme, weight } from '../theme';

/**
 * A one-box-per-digit code entry, the shape people expect from every other app
 * that mails them a code.
 *
 * WHY IT IS ONE INPUT AND NOT SIX. Six real inputs means managing focus by
 * hand, and every implementation of that gets paste wrong — a six-digit code
 * pasted from the mail app lands entirely in box one, or is silently truncated
 * to a single character. So there is ONE hidden input holding the whole value
 * (which paste, autofill and the OS's one-time-code suggestion all understand)
 * and the boxes are just a drawing of it.
 *
 * Tapping anywhere focuses that input, so the boxes behave like the control
 * they are impersonating.
 */
export function CodeBoxes({
  value,
  onChange,
  length = 6,
  autoFocus = false,
  editable = true,
}: {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  autoFocus?: boolean;
  editable?: boolean;
}) {
  const input = useRef<TextInput>(null);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');
  // The box the next digit lands in — highlighted, so there is a cursor to
  // follow. Clamped, or a full code would light a box that does not exist.
  const active = Math.min(value.length, length - 1);

  return (
    <Pressable onPress={() => input.current?.focus()} style={styles.row}>
      {digits.map((d, i) => (
        <View
          key={i}
          style={[
            styles.box,
            d !== '' && styles.boxFilled,
            editable && i === active && styles.boxActive,
          ]}
        >
          <Text style={styles.digit}>{d}</Text>
        </View>
      ))}

      {/* The real field: invisible, but present — so the keyboard, paste and
          SMS/email autofill all work normally. Not `display:none`, which would
          stop it receiving focus at all. */}
      <TextInput
        ref={input}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={length}
        autoFocus={autoFocus}
        editable={editable}
        caretHidden
        style={styles.hidden}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.xs },
  box: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  boxFilled: { borderColor: theme.brand },
  boxActive: { borderColor: theme.brand, backgroundColor: 'rgba(217,184,124,0.08)' },
  digit: { color: theme.text, fontSize: 20, fontFamily: weight('700') },
  // Stretched over the boxes rather than sized to nothing: a zero-size input is
  // unfocusable on some Android builds, which would make the whole control dead.
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: 'transparent',
  },
});
