import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { Send, Smile, List } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ChatMessage } from '@/hooks/useTableChat';

/**
 * The comment sheet, opened from the spade in the table toolbar.
 *
 * ITS OWN PANEL, deliberately separate from the chat drawer. An earlier pass
 * bolted the paid tiers and the quick phrases onto `ChatBox`, which put them in
 * front of every ordinary message and in the way of the voice recorder. Victor:
 * "it should not interfare with the charbot". Chat is chat; this is the
 * reference's comment surface, and the two share nothing but the send path.
 *
 * WHAT IS WIRED: the text box and the quick phrases both send an ordinary chat
 * message, so they need nothing new on the server. History is the same table
 * chat log, read-only.
 *
 * WHAT IS NOT: the 10 / 50 / 100 tiers. Those spend real chips, which means
 * `transfer()` in financial-core and senior review (iron rules 1 and 5); no
 * socket command carries a paid comment and no ledger type covers one. They
 * are drawn because the tiers are the owner's design, and disabled with a
 * readable reason because a chip-spending button that quietly does nothing is
 * the worst possible version of this control.
 */

/**
 * The reference's canned lines, as KEYS rather than sentences.
 *
 * Translated like every other string: a phrase hardcoded in English on a
 * Chinese table is exactly the mistake the eight-locale rule exists to prevent,
 * and these are the one kind of message a player sends without typing it.
 */
const QUICK_PHRASES = [
  'table.phraseShowChips',
  'table.phraseNotLuck',
  'table.phraseNeverSayDie',
  'table.phraseNothingSeek',
  'table.phraseWheelTurns',
  'table.phraseCardsAreWar',
] as const;

/** Chip costs the reference offers. Drawn, not wired — see the note above. */
const PAID_TIERS = [10, 50, 100] as const;

const MAX_LENGTH = 36;

export function CommentSheet({
  open,
  onClose,
  onSend,
  messages,
  disabled = false,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
  /** The table chat log, shown under History. */
  messages: ChatMessage[];
  /** Spectators cannot comment; the server refuses it either way. */
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'comment' | 'history'>('comment');
  const [input, setInput] = useState('');

  const send = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/50"
          />
          {/* Bottom sheet, as the reference has it — the table stays visible
              above so a player can still watch the hand they are talking about. */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            role="dialog"
            aria-label={t('table.comment')}
            className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[70vh] flex-col rounded-t-2xl border-t border-border bg-[#141013]/97 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-md"
          >
            {/* Paid tiers. Disabled, and the reason is right under them. */}
            <div className="flex items-center gap-2 px-3 pt-3">
              {PAID_TIERS.map((cost) => (
                <button
                  key={cost}
                  type="button"
                  disabled
                  title={t('table.paidCommentSoon')}
                  className="flex flex-1 cursor-not-allowed items-center justify-center gap-1 rounded-full border border-white/15 bg-black/55 py-1.5 text-[0.66rem] font-bold text-white/80 opacity-80"
                >
                  {t('table.comment')}
                  <span className="text-coin-gold">{cost} ●</span>
                </button>
              ))}
            </div>
            <p className="px-4 pt-1 text-[0.55rem] text-dim/70">{t('table.paidCommentSoon')}</p>

            {tab === 'comment' ? (
              <>
                {/* Composer */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(input);
                  }}
                  className="flex items-center gap-2 px-3 pt-3"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-dim">
                    <List size={15} />
                  </span>
                  <div className="relative min-w-0 flex-1">
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value.slice(0, MAX_LENGTH))}
                      disabled={disabled}
                      placeholder={
                        disabled ? t('table.chatDisabled') : t('table.commentPlaceholder')
                      }
                      className="w-full rounded-lg border border-border bg-black/30 py-2 pl-3 pr-12 text-[0.78rem] text-text placeholder:text-dim focus:border-brand focus:outline-none disabled:opacity-60"
                    />
                    {/* The counter the reference shows. Live, so a player knows
                        before they hit the wall rather than after. */}
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.6rem] tabular-nums text-dim">
                      {input.length}/{MAX_LENGTH}
                    </span>
                  </div>
                  <button
                    type="submit"
                    disabled={!input.trim() || disabled}
                    aria-label={t('table.comment')}
                    className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-dim disabled:opacity-40"
                  >
                    {input.trim() ? <Send size={14} /> : <Smile size={15} />}
                  </button>
                </form>

                {/* Quick phrases — each sends itself as an ordinary message. */}
                <ul className="flex-1 overflow-y-auto px-4 py-2">
                  {QUICK_PHRASES.map((key) => (
                    <li key={key}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => send(t(key))}
                        className="flex w-full items-center gap-2 border-b border-border/40 py-2.5 text-left text-[0.76rem] text-text last:border-b-0 disabled:opacity-50"
                      >
                        <span className="text-coin-gold">•</span>
                        {t(key)}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <ul className="flex-1 overflow-y-auto px-4 py-2">
                {messages.length === 0 ? (
                  <li className="py-6 text-center text-[0.72rem] text-dim">
                    {t('table.noComments')}
                  </li>
                ) : (
                  messages.map((msg) => (
                    <li
                      key={msg.id}
                      className="border-b border-border/40 py-2 text-[0.74rem] last:border-b-0"
                    >
                      <span className="mr-1.5 font-bold text-dim">{msg.senderName}</span>
                      {/* A voice note has no text to print; say so rather than
                          rendering an empty line. */}
                      <span className="text-text">{msg.text ?? t('table.voiceNote')}</span>
                    </li>
                  ))
                )}
              </ul>
            )}

            {/* Tabs, at the bottom as the reference places them. */}
            <div className="flex border-t border-border/60">
              {(['comment', 'history'] as const).map((which) => (
                <button
                  key={which}
                  type="button"
                  onClick={() => setTab(which)}
                  className={cn(
                    'flex-1 border-b-2 py-2.5 text-[0.74rem] font-semibold transition-colors',
                    tab === which
                      ? 'border-coin-gold text-coin-gold'
                      : 'border-transparent text-dim',
                  )}
                >
                  {which === 'comment' ? t('table.comment') : t('table.history')}
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
