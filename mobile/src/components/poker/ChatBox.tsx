import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { radius, space, theme } from '../../theme';

/**
 * Table chat.
 *
 * Ported from `frontend/src/components/poker/ChatBox.tsx`.
 *
 * WHAT IS MISSING, AND WHY
 *
 * The web version also records and plays voice notes. That half is NOT here: playback needs an
 * audio player and recording needs microphone capture, which on React Native means a new native
 * dependency (`expo-audio`) and a rebuild. That is a call worth making deliberately rather than
 * smuggling in behind a chat box, so text ships now and voice is a decision to take separately.
 *
 * The consequence is honest rather than hidden: `onSendVoice` is not a prop, so there is no
 * microphone button. The web original only draws that button when voice is both wired AND
 * supported, for the same reason — an inert microphone is the dead control this project has been
 * removing, not adding.
 *
 * A voice note that ARRIVES is still handled: it renders as a line saying the app cannot play it
 * yet. Dropping it silently would make the recipient think nothing was sent.
 */

/** Mirrors `ChatMessage` in frontend/src/hooks/useTableChat.ts. */
export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  timestamp: number;
  isSystem?: boolean;
  /** Present on a typed message. */
  text?: string;
  /** Present on a voice note: base64 audio plus what is needed to play it. */
  voice?: { clip: string; durationMs: number; mime: string };
}

const MAX_LENGTH = 200;

export function ChatBox({
  messages,
  onSend,
  myPlayerId,
  disabled = false,
  placeholder = 'Say something...',
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  /** Whose messages sit on the right. Passed in rather than read from a store, so this component
   *  has no opinion about where the session lives. */
  myPlayerId?: string | undefined;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  // Follow the conversation. `animated` is off for the first paint so opening the chat does not
  // visibly scroll through the backlog.
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: messages.length > 0 });
  }, [messages]);

  const submit = (): void => {
    const text = input.trim();
    if (!text || disabled) return;
    onSend(text);
    setInput('');
  };

  return (
    <View style={styles.wrap}>
      <ScrollView ref={scrollRef} style={styles.log} contentContainerStyle={styles.logContent}>
        {messages.length === 0 ? (
          <Text style={styles.empty}>No messages yet. Be the first to say hello!</Text>
        ) : (
          messages.map((msg) => {
            const mine = myPlayerId !== undefined && myPlayerId === msg.senderId;
            return (
              <View
                key={msg.id}
                style={[
                  styles.row,
                  msg.isSystem ? styles.rowSystem : mine ? styles.rowMine : styles.rowTheirs,
                ]}
              >
                {!msg.isSystem ? <Text style={styles.sender}>{msg.senderName}</Text> : null}

                {msg.voice ? (
                  // Received but unplayable here. Say so — an empty bubble reads as a bug.
                  <Text style={styles.note}>
                    Voice note ({Math.max(1, Math.round(msg.voice.durationMs / 1_000))}s) — not
                    playable in the app yet
                  </Text>
                ) : msg.text === undefined ? (
                  // Its audio was trimmed to keep memory bounded.
                  <Text style={styles.note}>Voice note expired</Text>
                ) : (
                  <View
                    style={[
                      styles.bubble,
                      msg.isSystem ? styles.bubbleSystem : mine ? styles.bubbleMine : styles.bubbleTheirs,
                    ]}
                  >
                    <Text style={msg.isSystem ? styles.systemText : styles.bubbleText}>
                      {msg.text}
                    </Text>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={disabled ? 'Chat is off at this table' : placeholder}
          placeholderTextColor={theme.dim}
          editable={!disabled}
          maxLength={MAX_LENGTH}
          returnKeyType="send"
          onSubmitEditing={submit}
          style={[styles.input, disabled && styles.inputOff]}
        />
        <Pressable
          onPress={submit}
          disabled={!input.trim() || disabled}
          style={[styles.send, (!input.trim() || disabled) && styles.sendOff]}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  log: { flex: 1 },
  logContent: { padding: space.md, gap: space.sm },
  empty: { color: theme.dim, fontSize: 12, fontStyle: 'italic', textAlign: 'center', padding: space.lg },
  row: { flexDirection: 'column' },
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  rowSystem: { alignItems: 'center', opacity: 0.7 },
  sender: { color: theme.dim, fontSize: 10, fontWeight: '700', marginBottom: 2 },
  bubble: { maxWidth: '85%', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1 },
  bubbleMine: { backgroundColor: 'rgba(187,92,246,0.2)', borderColor: 'rgba(187,92,246,0.3)' },
  bubbleTheirs: { backgroundColor: theme.surface2, borderColor: theme.border },
  bubbleSystem: {
    backgroundColor: theme.surface2,
    borderColor: 'transparent',
    borderRadius: radius.pill,
    paddingHorizontal: 12,
  },
  bubbleText: { color: theme.text, fontSize: 12 },
  systemText: { color: theme.dim, fontSize: 11, fontStyle: 'italic' },
  note: {
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    paddingHorizontal: 12,
    paddingVertical: 4,
    color: theme.dim,
    fontSize: 11,
    fontStyle: 'italic',
    overflow: 'hidden',
  },
  composer: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  input: {
    flex: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.bg,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    color: theme.text,
    fontSize: 13,
  },
  inputOff: { opacity: 0.6 },
  send: {
    borderRadius: radius.pill,
    backgroundColor: theme.brand,
    paddingHorizontal: space.md,
    justifyContent: 'center',
  },
  sendOff: { opacity: 0.4 },
  sendText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
