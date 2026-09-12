import { useEffect, useState } from 'react';
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
  tableId,
  openedAt,
}: {
  open: boolean;
  onClose: () => void;
  seats: LiveSeat[];
  /** Watchers with no seat. Undefined when the server has not said. */
  spectators?: number;
  /** Tapping a row opens that player's profile. */
  onPlayer?: (playerId: string) => void;
  /** Shown in the header, as the reference does. */
  tableId?: string;
  /** Epoch ms the table opened, from the server. */
  openedAt?: number;
}) {
  const { t } = useTranslation();

  /**
   * How long this table has been running, as HH:MM:SS.
   *
   * From the SERVER's `openedAt`, not from when this client opened the panel —
   * the table's age is a fact about the table, and two players opening the list
   * at different moments must see the same number.
   *
   * The interval runs only while the panel is open and only when there is a
   * time to count from; a closed drawer does not tick.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open || openedAt === undefined) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [open, openedAt]);

  const elapsed =
    openedAt === undefined
      ? null
      : (() => {
          const total = Math.max(0, Math.floor((now - openedAt) / 1000));
          const pad = (n: number) => String(n).padStart(2, '0');
          return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
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
            /* AS TALL AS ITS CONTENT. `inset-y-0` stretched this to full
               height, so an empty table showed one line of text above a screen
               of nothing. It grows with the rows and only reaches the cap when
               there are genuinely enough players to need it. */
            /* SAFE AREA. `fixed` is viewport-relative, so the safe-area padding
               on `body` (index.css) does not reach it — a drawer pinned to
               `top-0` puts its first row under the status bar and Telegram's
               own header. Reported on a device screenshot: the table id and
               the clock were sitting behind the carrier and battery icons.
               The native app had the identical fault. */
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
            className="fixed left-0 top-0 z-50 flex max-h-[88vh] w-[min(86vw,22rem)] flex-col overflow-y-auto rounded-br-2xl border-b border-r border-border bg-surface/95 shadow-2xl backdrop-blur-md"
          >
            {/* The reference's header: table id on the left, how long the
                table has been running on the right. The clock is driven off
                the SERVER's `openedAt`, so it is the table's real age rather
                than how long this client has had the panel open — two people
                opening it at different times see the same number. */}
            <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
              <span className="min-w-0 truncate font-mono text-[0.72rem] text-brand">
                {tableId ? `#${tableId}` : t('table.playerList')}
              </span>
              {elapsed !== null && (
                <span className="shrink-0 font-mono text-[0.78rem] tabular-nums text-brand">
                  {elapsed}
                </span>
              )}
            </div>

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
              <div className="flex items-center gap-2 border-t border-border/60 px-4 py-3 text-[0.7rem] text-dim">
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
