import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, space, theme } from '../../theme';

/**
 * The bot check.
 *
 * Ported from `frontend/src/components/poker/ChallengeModal.tsx`. Another player has challenged
 * you; tap to prove you are human. The response time is what the server scores, so the clock starts
 * when the prompt actually appears rather than when the challenge arrived.
 *
 * Deliberately has no dismiss: no backdrop press, and `onRequestClose` is a no-op so Android's Back
 * cannot close it either. Every other sheet in this app treats Back as cancel, and that is right
 * for them — this one is a challenge you answer, and letting it be waved away would make the whole
 * anti-bot check optional for anyone who knows the gesture.
 */
export function ChallengeModal({
  open,
  onAnswer,
}: {
  open: boolean;
  challengerId: string;
  onAnswer: (passed: boolean, responseMs: number) => void;
}) {
  const [shownAt, setShownAt] = useState(0);
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!open) return;
    setShownAt(Date.now());
    enter.setValue(0);
    const anim = Animated.spring(enter, { toValue: 1, friction: 7, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [open, enter]);

  if (!open) return null;

  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, { opacity: enter, transform: [{ scale }] }]}>
          <View style={styles.stripe} />

          <View style={styles.badge}>
            <Text style={styles.badgeGlyph}>!</Text>
          </View>

          <Text style={styles.title}>Bot Check</Text>
          <Text style={styles.body}>
            Another player has challenged you to prove you are human. Please tap the button below.
          </Text>

          <Pressable
            style={styles.button}
            onPress={() => onAnswer(true, Date.now() - shownAt)}
          >
            <Text style={styles.buttonText}>I am Human</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: space.xl,
    alignItems: 'center',
    overflow: 'hidden',
  },
  stripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: theme.danger,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(248,86,119,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  badgeGlyph: { color: theme.danger, fontSize: 32, fontWeight: '900' },
  title: { color: theme.text, fontSize: 20, fontWeight: '700', marginBottom: space.sm },
  body: {
    color: theme.dim,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: space.xl,
  },
  button: {
    width: '100%',
    height: 48,
    borderRadius: radius.card,
    backgroundColor: theme.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
