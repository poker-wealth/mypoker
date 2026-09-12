import { useState, useRef, useEffect } from 'react';
import { Send, MessageSquareOff, Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ChatMessage } from '@/hooks/useTableChat';
import { useVoiceRecorder, type VoiceClip } from '@/hooks/useVoiceRecorder';
import { VoiceNote } from './VoiceNote';
import { useSession } from '@/store/session';
import { toast } from '@/store/toast';

/**
 * Canned table talk, after the reference's list.
 *
 * KEYS, not sentences — each is translated like any other string. A canned
 * phrase hardcoded in English on a Chinese table is precisely the mistake the
 * eight-locale rule exists to prevent, and these are the one kind of message a
 * player sends without typing it.
 *
 * Each sends itself as an ordinary chat message, so the server needs nothing
 * new: a quick phrase IS a chat message, just one nobody had to type.
 */
const QUICK_PHRASES = [
  'table.phraseShowChips',
  'table.phraseNotLuck',
  'table.phraseNeverSayDie',
  'table.phraseNothingSeek',
  'table.phraseWheelTurns',
  'table.phraseCardsAreWar',
] as const;

export function ChatBox({
  messages,
  onSend,
  onSendVoice,
  disabled = false,
  placeholder = "Say something..."
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  /** Omitted where voice does not belong (e.g. a read-only transcript). */
  onSendVoice?: (clip: VoiceClip) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { player } = useSession();
  const { t } = useTranslation();
  const voice = useVoiceRecorder();

  // Recorder problems surface as a toast and are cleared, so the same failure
  // can be reported again next time rather than sticking as permanent state.
  useEffect(() => {
    if (!voice.error) return;
    toast.error(t(`table.${voice.error}`));
    voice.clearError();
  }, [voice, t]);

  /**
   * Release: stop, and send only if a usable clip came back.
   *
   * Every failure path inside the recorder resolves null and reports itself, so
   * there is nothing to catch here and nothing that can reach the table.
   */
  const endHold = async (): Promise<void> => {
    const clip = await voice.stop();
    if (clip && onSendVoice) onSendVoice(clip);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    onSend(input);
    setInput('');
  };

  return (
    <div className="flex h-full flex-col">
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-2 scroll-smooth"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-dim italic">
            No messages yet. Be the first to say hello!
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = player?.playerId === msg.senderId;
            return (
              <div 
                key={msg.id} 
                className={`flex flex-col text-[0.75rem] leading-tight ${
                  msg.isSystem ? 'items-center opacity-70' : isMe ? 'items-end' : 'items-start'
                }`}
              >
                {!msg.isSystem && (
                  <span className="text-[0.6rem] font-bold text-dim mb-0.5">
                    {msg.senderName}
                  </span>
                )}
                {msg.voice ? (
                  <VoiceNote
                    clip={msg.voice.clip}
                    durationMs={msg.voice.durationMs}
                    mime={msg.voice.mime}
                    mine={isMe}
                  />
                ) : msg.text === undefined ? (
                  // Its audio was trimmed to keep memory bounded. Say that,
                  // rather than rendering an empty bubble.
                  <div className="rounded-full bg-surface-2 px-3 py-1 text-[0.65rem] italic text-dim">
                    {t('table.voiceExpired')}
                  </div>
                ) : (
                  <div
                    className={`rounded-xl px-2.5 py-1.5 break-words max-w-[85%] shadow-sm ${
                      msg.isSystem
                        ? 'bg-surface-2 text-dim italic px-3 text-[0.65rem] rounded-full'
                        : isMe
                          ? 'bg-brand/20 border border-brand/30 text-brand-fg'
                          : 'bg-surface-2 border border-border text-text'
                    }`}
                  >
                    {msg.text}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/*
        PAID COMMENTS — present, disabled, and honest about why.

        The reference offers three tiers that cost 10 / 50 / 100 chips. That is
        real money leaving a player's balance, so it has to move through
        `transfer()` in financial-core and be senior-reviewed (root CLAUDE.md
        iron rules 1 and 5). No such command exists on the table socket and no
        ledger entry type covers it, so these cannot be wired from here.

        Drawn rather than omitted because the tiers are the owner's design, and
        disabled with a readable reason rather than greyed in silence — a
        chip-spending button that quietly does nothing is the worst possible
        version of this control.
      */}
      {!disabled && (
        <div className="flex items-center gap-1.5 px-2 pt-2">
          {[10, 50, 100].map((cost) => (
            <button
              key={cost}
              type="button"
              disabled
              title={t('table.paidCommentSoon')}
              className="flex flex-1 cursor-not-allowed items-center justify-center gap-1 rounded-full border border-border bg-surface-2/60 py-1 text-[0.62rem] font-bold text-dim opacity-60"
            >
              {t('table.comment')} <span className="text-jackpot">{cost}</span>
            </button>
          ))}
        </div>
      )}
      {!disabled && (
        <p className="px-3 pt-1 text-[0.55rem] text-dim/70">{t('table.paidCommentSoon')}</p>
      )}

      {/* QUICK PHRASES. Pure client — each one just sends itself as an ordinary
          chat message, so nothing new is needed on the server. Translated like
          any other string: a canned phrase in English on a Chinese table is
          exactly the mistake the locale rule exists for. */}
      {!disabled && (
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar px-2 pt-2">
          {QUICK_PHRASES.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onSend(t(key))}
              className="shrink-0 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[0.62rem] text-dim active:bg-surface"
            >
              {t(key)}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 p-2 border-t border-border/50">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            voice.recording ? t('table.voiceRecording') : disabled ? t('table.chatDisabled') : placeholder
          }
          disabled={disabled || voice.recording}
          maxLength={200}
          className="flex-1 rounded-full border border-border bg-bg/50 px-3 py-1.5 text-[0.8rem] text-text placeholder:text-dim focus:border-brand focus:outline-none disabled:opacity-60"
        />

        {/* Press and hold. Shown only where voice is wired and the browser can
            actually record — an inert microphone is the dead control this
            project has been removing, not adding. */}
        {onSendVoice && voice.supported && (
          <button
            type="button"
            disabled={disabled}
            aria-label={t('table.voiceHold')}
            onPointerDown={(e) => { e.preventDefault(); voice.start(); }}
            onPointerUp={(e) => { e.preventDefault(); void endHold(); }}
            // Dragging off the button, or the browser stealing the pointer,
            // must not leave the microphone open forever.
            onPointerLeave={() => { if (voice.recording) void endHold(); }}
            onPointerCancel={() => voice.cancel()}
            onContextMenu={(e) => e.preventDefault()} // long-press menu on mobile
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
              voice.recording
                ? 'border-danger bg-danger/20 text-danger'
                : 'border-border bg-bg/50 text-dim hover:text-text'
            } disabled:opacity-40 touch-none select-none`}
          >
            <Mic size={15} />
            {voice.recording && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full border-2 border-danger"
                style={{ clipPath: `inset(${(1 - voice.progress) * 100}% 0 0 0)` }}
              />
            )}
          </button>
        )}

        <Button
          size="sm"
          disabled={!input.trim() || disabled || voice.recording}
          className="rounded-full px-3"
        >
          {disabled ? <MessageSquareOff size={15} /> : <Send size={15} />}
        </Button>
      </form>
    </div>
  );
}
