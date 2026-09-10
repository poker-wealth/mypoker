import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Svg, Path, Circle } from 'react-native-svg';
import { radius, space, theme } from '../../theme';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

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

function VoiceNoteBubble({ voice, mine }: { voice: { clip: string; durationMs: number; mime: string }; mine: boolean }) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  async function play() {
    if (sound) {
      if (isPlaying) {
        await sound.pauseAsync();
        setIsPlaying(false);
      } else {
        await sound.playAsync();
        setIsPlaying(true);
      }
      return;
    }
    try {
      const ext = voice.mime.includes('mp4') || voice.mime.includes('m4a') ? 'm4a' : 'caf';
      const uri = (FileSystem as any).documentDirectory + 'note_' + Date.now() + '.' + ext;
      await FileSystem.writeAsStringAsync(uri, voice.clip, { encoding: FileSystem.EncodingType.Base64 });
      
      const { sound: s } = await Audio.Sound.createAsync({ uri });
      s.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setIsPlaying(false);
          s.setPositionAsync(0);
        }
      });
      setSound(s);
      await s.playAsync();
      setIsPlaying(true);
    } catch (e) {
      console.error('Playback failed', e);
    }
  }

  useEffect(() => {
    return () => {
      if (sound) sound.unloadAsync();
    };
  }, [sound]);

  return (
    <Pressable onPress={play} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: mine ? 'rgba(255,255,255,0.2)' : theme.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={mine ? "white" : theme.brand} strokeWidth={2}>
          {isPlaying ? <Path d="M10 4v16M14 4v16" /> : <Path d="M5 3l14 9-14 9V3z" />}
        </Svg>
      </View>
      <Text style={mine ? {color: 'white', fontSize: 13} : styles.bubbleText}>
        {Math.max(1, Math.round(voice.durationMs / 1000))}s
      </Text>
    </Pressable>
  );
}

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
  const [recording, setRecording] = useState<Audio.Recording | null>(null);

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

  async function startRecording() {
    if (disabled || !onSendVoice) return;
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status === 'granted') {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });
        const { recording: r } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        setRecording(r);
      }
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  }

  async function stopRecording() {
    if (!recording) return;
    setRecording(null);
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      const status = await recording.getStatusAsync();
      const durationMs = status.durationMillis;
      
      // Only send if > 500ms
      if (uri && durationMs > 500 && onSendVoice) {
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        onSendVoice(base64, durationMs, 'audio/m4a');
      }
    } catch (error) {
      console.error('Failed to stop recording', error);
    }
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
                  <VoiceNoteBubble voice={msg.voice} mine={mine} />
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
