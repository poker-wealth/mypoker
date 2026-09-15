import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Star, Share2, User } from 'lucide-react';
import { useTableHands } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import type { HandView } from '@/api/hands';
import type { Card } from '@/lib/cards';
import { chips } from '@/lib/money';
import { cn } from '@/lib/cn';
import { PlayingCard } from './PlayingCard';

/**
 * The hand-history panel, opened from the table menu.
 *
 * WHAT IS REAL: the table's name, blinds, how many are seated, its id, Share —
 * all off the snapshot — and now THE HANDS THEMSELVES. Every hand you were
 * dealt into at this table is recorded server-side (history/hand-store.ts) and
 * read back through `GET /me/hands`, newest first. The scrubber steps through
 * them: the board, each player's result, and the cards the table actually saw.
 * An opponent's folded cards never reach this screen — the gateway strips them
 * (history/hand-view.ts), so there is nothing here to hide.
 *
 * STILL DISABLED, each with its reason: anonymous seating and favourite tables,
 * neither of which has a backend.
 */
export function HandHistoryPanel({
  open,
  onClose,
  name,
  tableId,
  smallBlind,
  bigBlind,
  seated,
  onShare,
  nameOf,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  tableId: string;
  smallBlind: number;
  bigBlind: number;
  /** How many are sitting. Real, from the snapshot. */
  seated: number;
  onShare: () => void;
  /** A player's display name, from the table. Absent for someone who has left. */
  nameOf?: (playerId: string) => string | undefined;
}) {
  const { t } = useTranslation();
  const handsQuery = useTableHands(tableId, open);
  const hands = handsQuery.data?.hands ?? [];
  /** Index into `hands`, which is newest first — 0 is the latest hand. */
  const [index, setIndex] = useState(0);

  // Every time the panel opens, start at the latest hand.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const total = hands.length;
  const current: HandView | undefined = hands[Math.min(index, Math.max(0, total - 1))];
  const olderAvailable = index < total - 1;
  const newerAvailable = index > 0;
  // The scrubber runs oldest → newest, left → right, so the latest hand is at the right end.
  const thumbPct = total > 1 ? ((total - 1 - index) / (total - 1)) * 100 : 100;

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
          {/* From the right, like the reference — and the table stays visible
              down the left edge so you can still see the hand. */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            role="dialog"
            aria-label={t('table.handHistory')}
            className="fixed inset-y-0 right-0 z-[61] flex w-[min(78vw,20rem)] flex-col bg-[#141013]/97 shadow-2xl backdrop-blur-md"
          >
            {/* Header — every figure here is real. */}
            <div className="flex items-start justify-between gap-3 px-4 pt-5">
              <div className="min-w-0">
                <p className="truncate text-[0.86rem] font-bold text-coin-gold">{name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[0.72rem] text-dim">
                  <span className="tabular-nums">
                    {smallBlind}/{bigBlind}
                  </span>
                  <User size={11} />
                  <span className="tabular-nums">{seated}</span>
                </p>
              </div>
              <p className="shrink-0 font-mono text-[0.72rem] text-coin-gold">#{tableId}</p>
            </div>

            {/* Anonymous — disabled, with why. */}
            <div className="mt-3 flex items-center justify-between gap-3 px-4">
              <span className="text-[0.74rem] text-dim">{t('table.anonymous')}</span>
              <span
                role="switch"
                aria-checked={false}
                aria-disabled
                title={t('table.anonymousSoon')}
                className="relative h-6 w-11 shrink-0 cursor-not-allowed rounded-full border border-border bg-surface-2 opacity-60"
              >
                <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white/70" />
              </span>
            </div>
            <p className="px-4 pt-1 text-[0.55rem] text-dim/70">{t('table.anonymousSoon')}</p>

            {/* The hand. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {handsQuery.isPending ? (
                <p className="pt-10 text-center text-[0.72rem] text-dim">{t('common.loading')}</p>
              ) : handsQuery.isError ? (
                <p className="pt-10 text-center text-[0.72rem] text-danger">{t(errorKey(handsQuery.error))}</p>
              ) : !current ? (
                <p className="pt-10 text-center text-[0.72rem] leading-relaxed text-dim">
                  {t('table.noHandHistory')}
                </p>
              ) : (
                <HandDetail hand={current} nameOf={nameOf} />
              )}
            </div>

            {/* The scrubber: older to the left, newer to the right. */}
            <div className="flex items-center gap-3 border-t border-border/60 px-4 py-3">
              <button
                type="button"
                disabled={!olderAvailable}
                onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
                aria-label={t('table.previousHand')}
                className="shrink-0 text-dim transition-colors active:text-text disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={17} />
              </button>

              <div className="min-w-0 flex-1">
                <div className="relative h-1 rounded-full bg-surface-2">
                  <span
                    className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-coin-gold/80"
                    style={{ left: `${thumbPct}%` }}
                  />
                </div>
                <p className="mt-1 text-center text-[0.62rem] tabular-nums text-dim">
                  {total === 0 ? '0/0' : `${total - index}/${total}`}
                </p>
              </div>

              <button
                type="button"
                disabled={!newerAvailable}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                aria-label={t('table.nextHand')}
                className="shrink-0 text-dim transition-colors active:text-text disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight size={17} />
              </button>

              {/* Favourites — no backend, so the count is literally zero. */}
              <button
                type="button"
                disabled
                title={t('table.favouritesSoon')}
                aria-label={t('table.favourite')}
                className="flex shrink-0 cursor-not-allowed flex-col items-center text-coin-gold opacity-60"
              >
                <Star size={16} />
                <span className="text-[0.55rem] tabular-nums">0/15</span>
              </button>

              {/* Share IS wired — the same invite link the menu copies. */}
              <button
                type="button"
                onClick={onShare}
                aria-label={t('table.menuShare')}
                className={cn('shrink-0 text-dim transition-colors active:text-text')}
              >
                <Share2 size={16} />
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** One recorded hand: its number and time, the board, and every player's result. */
function HandDetail({
  hand,
  nameOf,
}: {
  hand: HandView;
  nameOf?: (playerId: string) => string | undefined;
}) {
  const time = new Date(hand.playedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[0.9rem] font-black tabular-nums text-text">#{hand.handNumber}</span>
        <span className="text-[0.68rem] tabular-nums text-dim">{time}</span>
      </div>

      {/* The board as it was revealed. Nothing when everyone folded preflop. */}
      <div className="flex min-h-11 gap-1">
        {hand.community.map((c, i) => (
          <PlayingCard key={`${c}-${i}`} card={c as Card} size="sm" index={0} />
        ))}
      </div>

      <ul className="space-y-2">
        {hand.seats.map((s) => {
          const who = nameOf?.(s.playerId) ?? s.playerId.slice(0, 8);
          return (
            <li
              key={s.playerId}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-2 py-1.5',
                s.isYou ? 'border-coin-gold/40 bg-coin-gold/[0.06]' : 'border-border/50',
              )}
            >
              <div className="flex shrink-0 -space-x-2">
                {s.holeCards
                  ? s.holeCards.map((c, i) => (
                      <PlayingCard key={`${c}-${i}`} card={c as Card} size="sm" index={0} />
                    ))
                  : [0, 1].map((i) => <PlayingCard key={i} card={null} faceDown size="sm" index={0} />)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.72rem] font-semibold text-text">{who}</p>
                <p className="text-[0.58rem] uppercase tracking-wide text-dim">{s.position}</p>
              </div>
              {/* Signed result, with its own sign rather than a formatter's. */}
              <span
                className={cn(
                  'shrink-0 text-[0.78rem] font-black tabular-nums',
                  s.net > 0 ? 'text-success' : s.net < 0 ? 'text-danger' : 'text-dim',
                )}
              >
                {s.net > 0 ? '+' : s.net < 0 ? '−' : ''}
                {chips(Math.abs(s.net))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
