import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { PlayingCard } from './PlayingCard';

/**
 * The hand-rankings chart, strongest first — FOR THE VARIANT BEING PLAYED.
 *
 * SHORT DECK REORDERS TWO ROWS. With the 2s–5s stripped a flush becomes rarer
 * than a full house and outranks it, and the server implements exactly that:
 * `SHORT_DECK_RULES` in `game-server/src/games/texas/hand-evaluator.ts` ranks
 * Flush 6 and FullHouse 5, wired at `variants.ts`. Hands compare on a
 * `strength` the variant supplies, NOT on the raw `HandCategory` enum — the
 * enum is only base numbering, and reading it alone is how an earlier pass here
 * wrongly concluded the engine had no variant support and shipped the standard
 * order to Short Deck players.
 *
 * That is the error this comment exists to prevent repeating: a chart that
 * disagrees with the evaluator tells a player the opposite of what their money
 * will do. If the rules in the engine change, this list changes with them.
 *
 * (Triton rules, per the engine's own note: trips do NOT beat a straight, so
 * only the flush/full-house pair moves.)
 *
 * Example hands are illustrative and fixed — a picture of a category, never a
 * claim about anything that was dealt.
 */

interface Ranking {
  /** i18n key under `handRank.` */
  key: string;
  /** Five cards illustrating the category. */
  cards: string[];
}

const RANKINGS: Ranking[] = [
  { key: 'royalFlush', cards: ['Td', 'Jd', 'Qd', 'Kd', 'Ad'] },
  { key: 'straightFlush', cards: ['6c', '7c', '8c', '9c', 'Tc'] },
  { key: 'fourOfAKind', cards: ['Jc', 'Jd', 'Jh', 'Js', '8d'] },
  { key: 'fullHouse', cards: ['8d', '8c', '8h', 'Qc', 'Qs'] },
  { key: 'flush', cards: ['Qs', 'Ts', '7s', '9s', '2s'] },
  { key: 'straight', cards: ['9d', 'Th', 'Jc', 'Qs', 'Kd'] },
  { key: 'threeOfAKind', cards: ['Qc', 'Qd', 'Qh', '4s', 'Td'] },
  { key: 'twoPair', cards: ['8h', '7s', '7d', '6c', '6h'] },
  { key: 'pair', cards: ['7d', '9c', '8s', 'Kh', 'Ks'] },
  { key: 'highCard', cards: ['Qc', 'Jd', '7s', 'Kh', '6c'] },
];

export function HandRankings({
  open,
  onClose,
  game,
}: {
  open: boolean;
  onClose: () => void;
  /** The variant being played. Short Deck ranks a flush above a full house. */
  game?: string;
}) {
  const { t } = useTranslation();

  // Swap the two rows Short Deck inverts, mirroring SHORT_DECK_RULES. Built
  // from the standard list rather than kept as a second hardcoded array, so the
  // examples and names cannot drift apart between variants.
  const rankings = (() => {
    if (game !== 'short-deck') return RANKINGS;
    const out = [...RANKINGS];
    const flush = out.findIndex((r) => r.key === 'flush');
    const full = out.findIndex((r) => r.key === 'fullHouse');
    if (flush < 0 || full < 0) return RANKINGS;
    [out[flush], out[full]] = [out[full]!, out[flush]!];
    return out;
  })();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            role="dialog"
            aria-label={t('table.menuRankings')}
            className="fixed inset-x-3 top-1/2 z-[61] max-h-[86vh] -translate-y-1/2 overflow-y-auto rounded-(--radius-app) border border-border bg-surface p-4 shadow-2xl sm:mx-auto sm:max-w-md"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold">{t('table.menuRankings')}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('common.close')}
                className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-dim active:scale-95"
              >
                <X size={16} />
              </button>
            </div>

            <ol className="flex flex-col">
              {rankings.map((rank, i) => (
                <li
                  key={rank.key}
                  className="flex items-center gap-3 border-b border-border/50 py-2 last:border-b-0"
                >
                  {/* The five cards are the point of the chart — a name alone
                      does not teach anyone what a full house looks like. */}
                  <div className="flex shrink-0 gap-0.5">
                    {rank.cards.map((card) => (
                      <PlayingCard key={card} card={card} size="sm" />
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.74rem] font-semibold text-text">
                      {t(`handRank.${rank.key}`)}
                    </div>
                    {/* Rank number, so the ordering is explicit rather than
                        only implied by position on a scrolling list. */}
                    <div className="text-[0.6rem] text-dim">{i + 1}</div>
                  </div>
                </li>
              ))}
            </ol>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
