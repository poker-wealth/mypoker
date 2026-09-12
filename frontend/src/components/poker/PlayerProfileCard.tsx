import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { User, X } from 'lucide-react';
import { chips } from '@/lib/money';
import { cn } from '@/lib/cn';
import type { LiveSeat } from '@/lib/liveTable';

/**
 * A player's card, opened from the player list or a seat.
 *
 * WHAT IS HERE IS WHAT THE TABLE ACTUALLY KNOWS — name, id, chips in front of
 * them, hands played here, and this session's result. All five come off the
 * snapshot, which every viewer already has.
 *
 * WHAT IS NOT HERE, and why it is not a layout decision:
 *
 *  - VPIP, PFR, ALL-IN WIN RATE. These need preflop ACTION data — did they put
 *    money in voluntarily, did they raise — and the platform records no hand
 *    histories at all. There is nothing to compute them from. The reference
 *    prints 0% for each; on a new account that is indistinguishable from a
 *    real zero, which is the trap this project's rules exist to avoid.
 *  - GAMES and TOTAL HANDS "last 30 days". `/me/stats` is self-only; reading
 *    another player's would need a public profile endpoint, which does not
 *    exist. The only routes that expose another player's data are admin ones,
 *    and those answer 404 to everyone else BY DESIGN.
 *  - BALANCE. If that means their wallet, showing one player another's balance
 *    is a privacy decision, not a UI one, and not mine to make. The chips in
 *    front of them at this table are public — everyone can see the stack — so
 *    that is what is shown, labelled "chips" so it cannot be misread as their
 *    account.
 *  - VOICE REPLAY. Voice notes are relayed and never stored (see the room's
 *    `voice` handler), so there is nothing to replay from a profile.
 *
 * Those arrive when hand histories and a public profile endpoint do. Until
 * then this card is short and true rather than long and invented.
 */
export function PlayerProfileCard({
  seat,
  onClose,
}: {
  /** The seat to describe, or null when nothing is open. */
  seat: LiveSeat | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const boughtIn = seat?.boughtIn;
  const hands = seat?.handsPlayed ?? 0;
  const result = seat && boughtIn !== undefined ? seat.stack - boughtIn : null;

  return (
    <AnimatePresence>
      {seat && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            role="dialog"
            aria-label={seat.name}
            className="fixed inset-x-6 top-1/2 z-[61] -translate-y-1/2 rounded-2xl border border-border bg-surface p-5 shadow-2xl sm:mx-auto sm:max-w-xs"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-dim active:scale-95"
            >
              <X size={17} />
            </button>

            <div className="flex items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-2 text-dim">
                <User size={22} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-text">{seat.name}</p>
                {/* The id, so a player can be named to support. Monospaced
                    because it is something you read out or copy, not prose. */}
                <p className="truncate font-mono text-[0.64rem] text-dim">ID:{seat.playerId}</p>
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border/60 pt-4">
              <Stat label={t('table.profileChips')} value={chips(seat.stack)} />
              <Stat label={t('table.colHands')} value={String(hands)} />
              <Stat
                label={t('table.colResult')}
                // A dash until they have played. Nothing has happened yet,
                // which is not the same as breaking even.
                value={
                  result === null || hands === 0
                    ? '—'
                    : `${result >= 0 ? '+' : ''}${chips(result)}`
                }
                tone={result === null || hands === 0 ? undefined : result >= 0 ? 'up' : 'down'}
              />
            </dl>

            {/* Said out loud rather than left as an absence, so nobody reads
                the short card as a broken one. */}
            <p className="mt-4 text-[0.62rem] leading-snug text-dim">
              {t('table.profileStatsSoon')}
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
}) {
  return (
    <div>
      <dt className="text-[0.6rem] text-dim">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-sm font-black tabular-nums',
          tone === 'up' ? 'text-success' : tone === 'down' ? 'text-danger' : 'text-text',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
