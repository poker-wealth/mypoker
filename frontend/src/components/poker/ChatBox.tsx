import { useState, useRef, useEffect } from 'react';
import { Send, MessageSquareOff, Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ChatMessage } from '@/hooks/useTableChat';
import { useVoiceRecorder, type VoiceClip } from '@/hooks/useVoiceRecorder';
import { VoiceNote } from './VoiceNote';
import { useSession } from '@/store/session';
import { toast } from '@/store/toast';

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
