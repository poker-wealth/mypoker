import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { Eye, User } from 'lucide-react';
import { chips } from '@/lib/money';
import { cn } from '@/lib/cn';
import type { LiveSeat } from '@/lib/liveTable';

/**
 * Who is at the table: nickname, hands, buy-in and result.
 *
 * ALL FOUR COLUMNS ARE REAL, which took a small piece of server work rather
 * than a guess. The platform keeps no hand histories, so "hands" and "result"
 * could not be read from anywhere — but they do not need histories. A seat now
 * counts the hands it is dealt into, and records every chip brought to the
 * table (`boughtIn`, first buy-in plus each top-up). Result is then simply
 * `stack - boughtIn`: what this session has actually cost or made them, at this
 * table, right now.
 *
 * The top-up is why `boughtIn` accumulates rather than being set once. Without
 * that, a player who rebought would show a bigger stack and read as winning,
 * having won none of it.
 *
 * SPECTATORS ARE A COUNT, NEVER A LIST. Who is watching is not something the
 * table tells the people sitting at it — a name there turns a spectator into a
 * presence and hands a seated player information about who is studying them.
 * The reference shows a "Spectators" row; a number is what that row can
 * honestly hold.
 *
 * A seat that has not been dealt a hand yet shows a dash for its result, not
 * a zero: nothing has happened, which is not the same as breaking even.
 */
export function PlayerListPanel({
  open,
  onClose,
  seats,
  spectators,
  onPlayer,
}: {
  open: boolean;
  onClose: () => void;
  seats: LiveSeat[];
  /** Watchers with no seat. Undefined when the server has not said. */
  spectators?: number;
  /** Tapping a row opens that player's profile. */
  onPlayer?: (playerId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40"
          />
          {/* From the LEFT, like the menu drawer it sits beside in the footer
              bar — the chat drawer owns the right edge. */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            role="dialog"
            aria-label={t('table.playerList')}
            className="fixed inset-y-0 left-0 z-50 flex w-[min(86vw,22rem)] flex-col overflow-y-auto border-r border-border bg-surface/95 shadow-2xl backdrop-blur-md"
          >
            <h2 className="px-4 pb-2 pt-5 text-[0.7rem] font-bold uppercase tracking-wider text-dim">
              {t('table.playerList')}
            </h2>

            <table className="w-full text-left text-[0.7rem]">
              <thead>
                <tr className="border-b border-border/60 text-[0.6rem] uppercase tracking-wider text-dim">
                  <th className="px-3 py-2 font-bold">{t('table.colNickname')}</th>
                  <th className="px-2 py-2 text-right font-bold">{t('table.colHands')}</th>
                  <th className="px-2 py-2 text-right font-bold">{t('table.colBuyin')}</th>
                  <th className="px-3 py-2 text-right font-bold">{t('table.colResult')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {seats.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-dim">
                      {t('table.noOtherPlayers')}
                    </td>
                  </tr>
                ) : (
                  seats.map((seat) => {
                    const boughtIn = seat.boughtIn;
                    const hands = seat.handsPlayed ?? 0;
                    // No buy-in figure means the server has not sent one (an
                    // older build): the result is unknowable, not zero.
                    const result = boughtIn === undefined ? null : seat.stack - boughtIn;
                    return (
                      <tr
                        key={seat.playerId}
                        onClick={() => onPlayer?.(seat.playerId)}
                        className={cn(
                          'transition-colors',
                          onPlayer && 'cursor-pointer active:bg-surface-2/70',
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2">
                            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-dim">
                              <User size={12} />
                            </span>
                            <span className="min-w-0 truncate font-semibold text-text">
                              {seat.name}
                              {seat.isYou ? (
                                <span className="ml-1 text-[0.58rem] text-dim">
                                  {t('table.you')}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-dim">{hands}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-dim">
                          {boughtIn === undefined ? '—' : chips(boughtIn)}
                        </td>
                        <td
                          className={cn(
                            'px-3 py-2.5 text-right font-bold tabular-nums',
                            result === null || hands === 0
                              ? 'text-dim'
                              : result >= 0
                                ? 'text-success'
                                : 'text-danger',
                          )}
                        >
                          {/* A seat that has not played shows a dash. Nothing
                              has happened yet, which is not breaking even. */}
                          {result === null || hands === 0
                            ? '—'
                            : `${result >= 0 ? '+' : ''}${chips(result)}`}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Spectators — a count. Hidden entirely when the server has not
                sent one, rather than showing a confident zero. */}
            {spectators !== undefined && (
              <div className="mt-auto flex items-center gap-2 border-t border-border/60 px-4 py-3 text-[0.7rem] text-dim">
                <Eye size={13} className="shrink-0" />
                <span>{t('table.spectatorCount', { count: spectators })}</span>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
