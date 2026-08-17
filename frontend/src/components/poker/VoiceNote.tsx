import { useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * A received voice note: tap to play.
 *
 * The clip arrives as base64 on the socket and is turned into an object URL
 * only when it is first played — building one for every note as it lands would
 * pin every clip in memory for the life of the table. The URL is revoked when
 * the row unmounts, which is what lets the trimmed-out clips actually be freed.
 *
 * Nothing autoplays. A table where audio starts by itself is a table people
 * mute, and browsers block it anyway.
 */

/** base64 -> Blob, without a data: URL round-trip. */
function toBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const toggle = (): void => {
    if (broken) return;
    const el = audioRef.current;
    if (el && !el.paused) { el.pause(); setPlaying(false); return; }

    try {
      if (!urlRef.current) urlRef.current = URL.createObjectURL(toBlob(clip, mime));
      if (!audioRef.current) {
        const a = new Audio(urlRef.current);
        a.onended = () => { setPlaying(false); setElapsed(0); };
        a.ontimeupdate = () => setElapsed(a.currentTime * 1000);
        // A codec this browser cannot decode is a dud row, not a broken table.
        a.onerror = () => { setBroken(true); setPlaying(false); };
        audioRef.current = a;
      }
      void audioRef.current.play().then(() => setPlaying(true)).catch(() => setBroken(true));
    } catch {
      setBroken(true);
    }
  };

  const seconds = Math.max(1, Math.round(durationMs / 1000));
  const pct = playing && durationMs > 0 ? Math.min(100, (elapsed / durationMs) * 100) : 0;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={broken}
      aria-label={broken ? t('table.voiceUnplayable') : t('table.voicePlay', { seconds })}
      className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 shadow-sm transition-opacity ${
        broken ? 'opacity-50' : 'hover:opacity-90'
      } ${mine ? 'bg-brand/20 border border-brand/30' : 'bg-surface-2 border border-border'}`}
    >
      <span className={mine ? 'text-brand' : 'text-dim'}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </span>

      {/* A fixed set of bars, not a real waveform: an honest suggestion of audio
          rather than a picture of a signal we never analysed. */}
      <span className="flex items-center gap-[2px]" aria-hidden="true">
        {[6, 10, 14, 9, 12, 7, 11, 5].map((h, i) => {
          const filled = pct > (i / 8) * 100;
          return (
            <span
              key={i}
              style={{ height: `${h}px` }}
              className={`w-[2px] rounded-full ${
                filled ? (mine ? 'bg-brand' : 'bg-text') : mine ? 'bg-brand/40' : 'bg-dim/40'
              }`}
            />
          );
        })}
      </span>

      <span className="text-[0.65rem] tabular-nums text-dim">
        {broken ? t('table.voiceUnplayable') : `${seconds}s`}
      </span>
    </button>
  );
}
