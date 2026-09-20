import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SlidersHorizontal, ChevronLeft } from 'lucide-react';
import { useTables } from '@/api/hooks';
import { formatMicros } from '@/api/lobby';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';

/**
 * The open Texas Hold'em tables, as its own screen.
 *
 * This was the lower half of the lobby feed (components/lobby/HomeFeed.tsx,
 * removed on 16 Sep 2026 when Alliance went back to leagues and clubs only).
 * The Lobby is the Hold'em entry screen — PIN, Create Game — and this is what
 * its "Live Tables" link opens, so the tables the platform runs stay reachable
 * without crowding that screen.
 *
 * TEXAS ONLY, filtered SERVER-SIDE, so the rows and the count agree: asking for
 * everything and hiding the rest here would show "12 tables" over a list of
 * three. Every other game is reachable from Games.
 */

/**
 * The blind filters, in TABLE CHIPS — the unit the server filters in.
 *
 * These were micro-USD (2_000_000 for "1/2") against a server comparing table
 * chips, whose largest big blind is 100. Every threshold was therefore
 * unreachable and tapping ANY filter but ALL emptied the lobby completely.
 *
 * `minStakes` is the big blind, so the label's second number is the value.
 */
const STAKES_OPTIONS = [
  { id: 'all', label: 'ALL', minStakes: undefined },
  { id: '1/2', label: '1/2', minStakes: 2 },
  { id: '5/10', label: '5/10', minStakes: 10 },
  { id: '25/50', label: '25/50', minStakes: 50 },
  { id: '100/200', label: '100/200', minStakes: 200 },
];

/**
 * The blinds cell.
 *
 * Chips are not money: no currency mark, no micro conversion, just a grouped
 * integer. An em dash when the table has no blind structure at all — printing
 * "0/0" states a stake level that does not exist (docs/TRAPS.md #3).
 *
 * NO `stakes / 2` FALLBACK. An earlier draft used one and it promptly invented
 * a small blind: Dou Di Zhu has a flat base stake of 100 and no blinds at all,
 * and the fallback printed it as "50/100".
 */
function formatBlinds(stakes: number | null, smallBlind?: number | null): string {
  if (stakes === null || stakes === undefined) return '—';
  if (smallBlind === null || smallBlind === undefined) return stakes.toLocaleString();
  return `${smallBlind.toLocaleString()}/${stakes.toLocaleString()}`;
}

/**
 * A row, built only from what the server actually sent.
 *
 * There is deliberately no sample/fallback list. Six invented tables (T-001…,
 * "$1,200") used to render whenever the API returned nothing — a full lobby of
 * tables that do not exist. An empty lobby is a fact; a fabricated one is a lie
 * that also happens to be unjoinable.
 */
interface DisplayTable {
  id: string;
  blinds: string;
  players: string;
  buyIn: string;
  /** Pooled jackpot on this table, micro-USD. Null when the table has none. */
  jackpot: number | null;
  isFull: boolean;
  /** The table this player is seated at — the one refusing all the others. */
  youAreSeated: boolean;
}

export function LiveTables({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [blinds, setBlinds] = useState('all');
  const [onlyOpen, setOnlyOpen] = useState(false);

  const targetStakes = STAKES_OPTIONS.find((s) => s.id === blinds)?.minStakes;
  const tables = useTables({
    gameId: 'texas',
    minStakes: targetStakes,
    maxStakes: targetStakes,
    ...(onlyOpen ? { hasSeats: true } : {}),
  });

  const displayTables: DisplayTable[] = (tables.data?.tables ?? []).map((tbl) => ({
    id: tbl.id,
    blinds: formatBlinds(tbl.stakes, tbl.smallBlind),
    players: `${tbl.players} / ${tbl.maxPlayers}`,
    // The server's own figure. It used to fall back to 40 when absent, which
    // put a buy-in on the row that the table had never quoted.
    buyIn: tbl.buyInBB === null ? '—' : `${tbl.buyInBB} BB`,
    // Null rather than a substitute: `t.jackpot || t.stakes * 10` advertised
    // ten times the blind as a dollar amount on tables with an empty pool.
    jackpot: tbl.jackpot > 0 ? tbl.jackpot : null,
    isFull: tbl.status === 'FULL' || tbl.players >= tbl.maxPlayers,
    youAreSeated: tbl.youAreSeated === true,
  }));

  return (
    <div className="flex flex-col space-y-3.5 pb-4">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('common.back')}
          className="grid size-9 place-items-center rounded-lg text-dim transition-colors hover:bg-surface-2 hover:text-text"
        >
          <ChevronLeft size={20} />
        </button>
        {/* Padded by the button's width so the title centres on the screen. */}
        <h2 className="min-w-0 flex-1 truncate pr-9 text-center text-base font-black">
          {t('lobby.liveTables')}
        </h2>
      </div>

      {/* Stakes filters */}
      <div className="flex items-center justify-between gap-1.5 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1.5">
          {STAKES_OPTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setBlinds(s.id)}
              className={cn(
                'px-3 py-1.5 text-xs font-bold transition-all rounded-md shrink-0',
                blinds === s.id ? 'bg-gold text-bg shadow-xs' : 'bg-surface-2/80 text-dim hover:text-text',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        {/* The one filter a player in a lobby actually wants — hide tables they
            cannot sit at — which the API already supports via hasSeats. */}
        <button
          aria-label={t('lobby.onlyOpen')}
          aria-pressed={onlyOpen}
          onClick={() => {
            haptic('light');
            setOnlyOpen((v) => !v);
          }}
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-md border transition-colors active:scale-95',
            onlyOpen
              ? 'border-gold bg-[color-mix(in_srgb,var(--gold)_16%,transparent)] text-gold'
              : 'border-border bg-surface-2 text-dim hover:text-text',
          )}
        >
          <SlidersHorizontal size={14} />
        </button>
      </div>

      {/* `overflow-x-auto`, NOT `overflow-hidden`: five columns do not always fit
          the 520px shell, and clipping cut the Status column — the ONLY control
          in the row — off the right edge. */}
      <div className="overflow-x-auto no-scrollbar rounded-xl border border-border/80 bg-surface/90 shadow-sm">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border/60 text-[0.65rem] text-dim uppercase tracking-wider">
              <th className="px-2.5 py-2.5 font-bold">{t('lobby.colTable')}</th>
              <th className="px-2.5 py-2.5 font-bold whitespace-nowrap">{t('lobby.colBlinds')}</th>
              <th className="px-2.5 py-2.5 font-bold whitespace-nowrap">{t('lobby.colPlayers')}</th>
              <th className="px-2.5 py-2.5 font-bold whitespace-nowrap">{t('lobby.colBuyIn')}</th>
              <th className="px-2.5 py-2.5 text-right font-bold">{t('lobby.colStatus')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {tables.isPending ? (
              [0, 1, 2].map((i) => (
                <tr key={i}>
                  <td colSpan={5} className="px-3 py-3">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))
            ) : tables.isError ? (
              // An unreachable lobby is not an empty one. "No tables found" on a
              // failed request tells the player the platform is dead rather than
              // that we could not ask.
              <tr>
                <td colSpan={5} className="py-8 text-center text-dim">
                  {t('states.serviceUnavailable')}
                </td>
              </tr>
            ) : displayTables.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-dim">
                  {t('lobby.noTables')}
                </td>
              </tr>
            ) : (
              displayTables.map((tbl) => (
                <tr
                  key={tbl.id}
                  onClick={() => navigate(`/table/${tbl.id}`)}
                  className="cursor-pointer transition-colors active:bg-surface-2/80 hover:bg-surface-2/40"
                >
                  {/* The table's real id. It used to render `T-00${index}`, a
                      label invented per render that matched nothing a player
                      could be told over support. */}
                  <td className="px-2.5 py-3 font-bold whitespace-nowrap text-[#eab308]">
                    {tbl.id}
                    {tbl.youAreSeated && (
                      <span className="ml-2 rounded-full bg-brand/20 px-2 py-0.5 text-[0.6rem] font-bold text-brand align-middle">
                        {t('lobby.yourSeat')}
                      </span>
                    )}
                  </td>
                  <td className="px-2.5 py-3 tabular-nums whitespace-nowrap text-dim font-medium">{tbl.blinds}</td>
                  <td className="px-2.5 py-3 tabular-nums whitespace-nowrap font-semibold text-text">{tbl.players}</td>
                  <td className="px-2.5 py-3 tabular-nums whitespace-nowrap text-dim font-medium">{tbl.buyIn}</td>
                  <td className="px-2.5 py-3 text-right">
                    {tbl.isFull ? (
                      <span className="inline-block min-w-16 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-center text-[0.7rem] font-bold text-dim">
                        {t('lobby.wait')}
                      </span>
                    ) : (
                      <span className="inline-block min-w-16 rounded-md border border-jackpot/40 bg-[color-mix(in_srgb,var(--jackpot)_14%,transparent)] px-2.5 py-1 text-center text-[0.7rem] font-bold text-jackpot shadow-xs">
                        {/* Open, but with no pool to advertise: say the table is
                            open rather than print a dollar sign next to nothing. */}
                        {tbl.jackpot !== null ? `$${formatMicros(tbl.jackpot, 0)}` : t('lobby.open')}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
