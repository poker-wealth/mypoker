import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Svg, Path, Circle } from 'react-native-svg';
import { radius, space, theme } from '../../theme';
import { VoiceNote } from '../../VoiceNote';
import { useVoiceRecorder } from '../../useVoiceRecorder';

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

/*
 * Playback and recording come from the app's own audio pieces — `VoiceNote`
 * and `useVoiceRecorder`, both built on **expo-audio**.
 *
 * This file used to carry a SECOND implementation on `expo-av`, the
 * deprecated predecessor. Nothing else in the app pulls that library in, so
 * it was never compiled into the binary and the app died at boot with
 * "Cannot find native module 'ExponentAV'".
 *
 * The shared recorder also owns every rule about a usable clip (minimum
 * length, the 24KB ceiling, the pinned bitrate) in ONE place, rather than a
 * second copy of those limits drifting here.
 */

export function ChatBox({
  messages,
  onSend,
  onSendVoice,
  myPlayerId,
  disabled = false,
  placeholder = 'Say something...',
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onSendVoice?: (clip: string, durationMs: number, mime: string) => void;
  myPlayerId?: string | undefined;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const voice = useVoiceRecorder();
  const recording = voice.recording;

  // Follow the conversation
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: messages.length > 0 });
  }, [messages]);

  const submit = (): void => {
    const text = input.trim();
    if (!text || disabled) return;
    onSend(text);
    setInput('');
  };

  function startRecording(): void {
    if (disabled || !onSendVoice) return;
    voice.start();
  }

  /**
   * Stop and send. The hook returns null when the clip fails any of its own
   * rules, so a too-short tap or an over-budget recording sends nothing —
   * rather than a frame big enough to make `ws` drop the table socket.
   */
  async function stopRecording(): Promise<void> {
    if (!voice.recording) return;
    const clip = await voice.stop();
    if (clip && onSendVoice) onSendVoice(clip.clip, clip.durationMs, clip.mime);
  }

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
                  <VoiceNote
                    clip={msg.voice.clip}
                    durationMs={msg.voice.durationMs}
                    mime={msg.voice.mime}
                    mine={mine}
                  />
                ) : msg.text === undefined ? (
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
          placeholder={disabled ? 'Chat is disabled' : placeholder}
          placeholderTextColor={theme.dim}
          editable={!disabled}
          maxLength={MAX_LENGTH}
          returnKeyType="send"
          onSubmitEditing={submit}
          style={[styles.input, disabled && styles.inputOff]}
        />
        {input.trim() && !disabled ? (
          <Pressable onPress={submit} style={styles.micButton}>
             <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
               <Path d="M22 2 11 13" />
               <Path d="M22 2 15 22 11 13 2 9l20-7z" />
             </Svg>
          </Pressable>
        ) : disabled ? (
          <View style={[styles.micButton, { backgroundColor: '#2A2A2A' }]}>
             <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={theme.dim} strokeWidth={2}>
                <Path d="m2 2 20 20" />
                <Path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
                <Path d="M5 10v2a7 7 0 0 0 12 5" />
                <Path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
                <Path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
                <Path d="M12 19v4" />
                <Path d="M8 23h8" />
             </Svg>
          </View>
        ) : (
          <Pressable 
            onPressIn={startRecording} 
            onPressOut={stopRecording} 
            style={recording ? styles.micButtonRecording : styles.micButton}
          >
             <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
               <Path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
               <Path d="M19 10v2a7 7 0 0 1-14 0v-2" />
               <Path d="M12 19v4" />
               <Path d="M8 23h8" />
             </Svg>
          </Pressable>
        )}
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
  bubbleMine: { backgroundColor: '#D9B87C', borderColor: '#D9B87C' },
  bubbleTheirs: { backgroundColor: theme.surface2, borderColor: theme.border },
  bubbleSystem: {
    backgroundColor: theme.surface2,
    borderColor: 'transparent',
    borderRadius: radius.pill,
    paddingHorizontal: 12,
  },
  bubbleText: { color: theme.text, fontSize: 13 },
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
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    paddingBottom: space.lg,
  },
  input: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#111',
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 14,
  },
  inputOff: { opacity: 0.6 },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#D9B87C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonRecording: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.danger,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ scale: 1.2 }],
  },
});
