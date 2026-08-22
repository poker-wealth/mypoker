import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useTranslation } from 'react-i18next';
import { radius, space, theme } from './theme';
import { useVoiceRecorder, type VoiceClip } from './useVoiceRecorder';

/**
 * Voice notes at the table, native side — playback and the press-and-hold
 * control. Ported from frontend/src/components/poker/VoiceNote.tsx.
 *
 * THE SEAM: neither component here knows anything about the socket. `VoiceBar`
 * hands a finished `VoiceClip` to `onSend`, and `VoiceNote` renders one that
 * arrived. Wiring those to the live-table transport is the game side's half
 * (see mobile/CLAUDE.md) — this is the capture and playback, which is the part
 * that is genuinely platform-specific.
 *
 * PLAYBACK IS A FILE, NOT A BLOB. The web turns base64 into an object URL. RN
 * has no Blob URLs, and a data: URI of 32KB is not something every native
 * player will accept, so the clip is written to a cache file the first time it
 * is played and deleted when the row unmounts. Writing on first play rather
 * than on arrival matters: a busy table would otherwise put every clip it has
 * ever seen on disk.
 *
 * Nothing autoplays. A table where audio starts by itself is a table people
 * mute.
 */

/** Players sniff by extension, so the container has to be named honestly. */
function extensionFor(mime: string): string {
  if (mime.startsWith('audio/mp4') || mime.startsWith('audio/aac')) return '.m4a';
  if (mime.startsWith('audio/webm')) return '.webm';
  if (mime.startsWith('audio/ogg')) return '.ogg';
  return '.audio';
}

/** Unique per row, so two notes never fight over the same cache file. */
let seq = 0;

export function VoiceNote({
  clip,
  durationMs,
  mime,
  mine,
}: {
  clip: string;
  durationMs: number;
  mime: string;
  mine: boolean;
}) {
  const { t } = useTranslation();
  const playerRef = useRef<AudioPlayer | null>(null);
  const fileRef = useRef<File | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      playerRef.current?.remove();
      try {
        if (fileRef.current?.exists) fileRef.current.delete();
      } catch {
        // A cache file we could not remove is not worth surfacing.
      }
    };
  }, []);

  const stopTicking = (): void => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const toggle = (): void => {
    if (broken) return;

    const existing = playerRef.current;
    if (existing?.playing) {
      existing.pause();
      stopTicking();
      setPlaying(false);
      return;
    }

    try {
      if (!playerRef.current) {
        const file = new File(Paths.cache, `voice-${seq++}${extensionFor(mime)}`);
        if (file.exists) file.delete();
        file.create();
        file.write(clip, { encoding: 'base64' });
        fileRef.current = file;
        playerRef.current = createAudioPlayer({ uri: file.uri });
      }

      const player = playerRef.current;
      player.play();
      setPlaying(true);

      // Polled rather than subscribed: the clip is at most ten seconds, and a
      // 100ms tick is the same cadence the recorder already uses.
      stopTicking();
      tickRef.current = setInterval(() => {
        const p = playerRef.current;
        if (!p) return;
        setElapsed(p.currentTime * 1000);
        if (!p.playing) {
          stopTicking();
          setPlaying(false);
          setElapsed(0);
          // Back to the start, so a second tap replays rather than doing nothing.
          void p.seekTo(0).catch(() => undefined);
        }
      }, 100);
    } catch {
      // A codec this device cannot decode is a dud row, not a broken table.
      setBroken(true);
      setPlaying(false);
      stopTicking();
    }
  };

  const seconds = Math.max(1, Math.round(durationMs / 1000));
  const pct = playing && durationMs > 0 ? Math.min(100, (elapsed / durationMs) * 100) : 0;

  return (
    <Pressable
      onPress={toggle}
      disabled={broken}
      accessibilityRole="button"
      accessibilityLabel={broken ? t('table.voiceUnplayable') : t('table.voicePlay', { seconds })}
      style={[styles.note, mine ? styles.noteMine : styles.noteTheirs, broken && styles.dim]}
    >
      <Text style={[styles.glyph, { color: mine ? theme.brand : theme.dim }]}>
        {playing ? '❚❚' : '▶'}
      </Text>

      {/* A fixed set of bars, not a real waveform: an honest suggestion of
          audio rather than a picture of a signal we never analysed. */}
      <View style={styles.bars}>
        {[6, 10, 14, 9, 12, 7, 11, 5].map((h, i) => {
          const filled = pct > (i / 8) * 100;
          const on = mine ? theme.brand : theme.text;
          const off = mine ? 'rgba(187,92,246,0.4)' : 'rgba(255,255,255,0.25)';
          return (
            <View key={i} style={[styles.bar, { height: h, backgroundColor: filled ? on : off }]} />
          );
        })}
      </View>

      <Text style={styles.seconds}>{broken ? t('table.voiceUnplayable') : `${seconds}s`}</Text>
    </Pressable>
  );
}

/**
 * The press-and-hold control.
 *
 * Hold to record, release to send. Sliding off the button cancels — the same
 * escape hatch every messenger has, and the reason `onPressOut` is not the only
 * thing that can end a recording.
 *
 * `onSend` receives a clip that has already passed the duration and byte
 * checks. A clip that failed them never arrives here; the reason shows on the
 * bar instead.
 */
export function VoiceBar({ onSend }: { onSend: (clip: VoiceClip) => void }) {
  const { t } = useTranslation();
  const { recording, progress, error, clearError, start, stop, cancel } = useVoiceRecorder();

  /**
   * Slide-off must CANCEL, and onPressOut alone cannot tell the difference:
   * RN fires it both when the finger releases inside the button and when it
   * slides beyond the retention rect. What distinguishes the two is onPress,
   * which fires only for an inside release, synchronously after onPressOut in
   * the same event batch. So onPressOut arms a cancel on a 0ms timer, and
   * onPress — if it comes — disarms it and sends. On a slide-off no onPress
   * arrives, the timer survives the batch, and the recording is discarded.
   * The task-8 audit caught the old wiring sending on slide-off.
   */
  const pendingCancel = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armCancel = (): void => {
    pendingCancel.current = setTimeout(() => {
      pendingCancel.current = null;
      cancel();
    }, 0);
  };

  const send = (): void => {
    if (pendingCancel.current) {
      clearTimeout(pendingCancel.current);
      pendingCancel.current = null;
    }
    void stop().then((clip) => {
      if (clip) onSend(clip);
    });
  };

  return (
    <View style={styles.barWrap}>
      {error !== null && (
        <Pressable onPress={clearError} style={styles.errorPill}>
          <Text style={styles.errorText}>{t(`table.${error}`, { defaultValue: error })}</Text>
        </Pressable>
      )}

      <Pressable
        onPressIn={start}
        onPressOut={armCancel}
        onPress={send}
        // Responder theft (a scroll, an incoming call) — not the slide-off
        // path, which onPressOut + the missing onPress handles above.
        onTouchCancel={cancel}
        accessibilityRole="button"
        accessibilityLabel={t('table.voiceHold')}
        style={[styles.holdButton, recording && styles.holdButtonActive]}
      >
        <Text style={[styles.holdText, recording && styles.holdTextActive]}>
          {recording ? t('table.voiceRecording') : t('table.voiceHold')}
        </Text>

        {/* The remaining-time bar. It is the only warning that the ceiling is
            coming, and the ceiling sends rather than discards. */}
        {recording && <View style={[styles.progress, { width: `${progress * 100}%` }]} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  noteMine: { backgroundColor: 'rgba(187,92,246,0.2)', borderColor: 'rgba(187,92,246,0.3)' },
  noteTheirs: { backgroundColor: theme.surface2, borderColor: theme.border },
  dim: { opacity: 0.5 },
  glyph: { fontSize: 11 },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  bar: { width: 2, borderRadius: 1 },
  seconds: { color: theme.dim, fontSize: 10 },
  barWrap: { gap: space.xs },
  holdButton: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: space.md,
  },
  holdButtonActive: { backgroundColor: 'rgba(187,92,246,0.16)', borderColor: theme.brand },
  holdText: { color: theme.dim, fontSize: 13, fontWeight: '700' },
  holdTextActive: { color: theme.brand },
  progress: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 2,
    backgroundColor: theme.brand,
  },
  errorPill: {
    alignSelf: 'center',
    backgroundColor: 'rgba(248,86,119,0.16)',
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  errorText: { color: theme.danger, fontSize: 11 },
});
