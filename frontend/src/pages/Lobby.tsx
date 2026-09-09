import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Zap, SlidersHorizontal, Plus } from 'lucide-react';
import { useLobbyGames, useTables } from '@/api/hooks';
import { formatMicros } from '@/api/lobby';
import { ContextBanner } from '@/components/ContextBanner';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';
import { toast } from '@/lib/toast';

/**
 * A lobby row, built only from what the server actually sent.
 *
 * There is deliberately no sample/fallback list any more. Six invented tables
 * (T-001…T-006, with "$1,200" and "$980" in the status column) used to render
 * whenever the API returned nothing — which, with the gateway undeployed, is
 * every time. A player opening the app saw a full lobby of tables that do not
 * exist, priced with figures nobody computed. An empty lobby is a fact; a
 * fabricated one is a lie that also happens to be unjoinable.
 */
interface DisplayTable {
  id: string;
  blinds: string;
  players: string;
  buyIn: string;
  /** Pooled jackpot on this table, micro-USD. Null when the table has none. */
  jackpot: number | null;
  isFull: boolean;
  /** The table this player is seated at — the one that is refusing all the others. */
  youAreSeated: boolean;
  /** Table chips. Null when the game has no stake level — see formatBlinds. */
  stakes: number | null;
}

const VARIANTS = [
  { id: 'dezhou', label: 'DEZHOU' },
  { id: 'ausha', label: 'AUSHA' },
  { id: 'others', label: 'OTHERS' },
];

/**
 * The blind filters, in TABLE CHIPS — the unit the server filters in.
 *
 * These were micro-USD (2_000_000 for "1/2") against a server comparing table
 * chips, whose largest big blind is 100. Every threshold was therefore
 * unreachable and tapping ANY filter but ALL emptied the lobby completely.
 * Same root cause as the blinds column: the numbers were correct for
 * `dev-seed.ts` and nobody re-read them when the live rooms took over.
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
 * integer. An em dash when the table has no blind structure at all — nine of
 * the thirteen live tables let each player pick their own bet, and printing
 * "0/0" for them stated a stake level that does not exist (docs/TRAPS.md #3).
 *
 * NO `stakes / 2` FALLBACK. An earlier draft of this used one for tables whose
 * server had not sent a small blind, and it promptly invented one: Dou Di Zhu
 * has a flat base stake of 100 and no blinds at all, and the fallback printed
 * it as "50/100". A missing small blind means there is no pair to show, not
 * that it can be guessed — so a flat stake renders as the single figure it is.
 */
function formatBlinds(stakes: number | null, smallBlind?: number | null): string {
  if (stakes === null || stakes === undefined) return '—';
  if (smallBlind === null || smallBlind === undefined) return stakes.toLocaleString();
  return `${smallBlind.toLocaleString()}/${stakes.toLocaleString()}`;
}

export function Lobby() {
  const navigate = useNavigate();
  const lobby = useLobbyGames();
  const [variant, setVariant] = useState('dezhou');
  const [blinds, setBlinds] = useState('all');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const { t } = useTranslation();

  const targetStakes = STAKES_OPTIONS.find((s) => s.id === blinds)?.minStakes;

  // DEZHOU and AUSHA are single games and filter server-side. OTHERS means
  // "every table that is not one of those tabs" — a set the server has no
  // filter parameter for, and sending `gameId: 'others'` is a 400: the filter
  // parser rejects unknown game ids by design. (It always did; the sample-table
  // fallback used to swallow the error and show fake tables instead, which is
  // how a permanently broken tab went unnoticed.) So OTHERS fetches unfiltered
  // and excludes the named tabs' games client-side.
  const TAB_GAME: Record<string, string | undefined> = { dezhou: 'texas', ausha: 'omaha' };
  const tables = useTables({
    ...(TAB_GAME[variant] ? { gameId: TAB_GAME[variant] } : {}),
    minStakes: targetStakes,
    maxStakes: targetStakes,
    // Stakes and seat filters stay server-side, so the count the lobby shows
    // is the count the server filtered.
    ...(onlyOpen ? { hasSeats: true } : {}),
  });

  const rawTables =
    variant === 'others'
      ? (tables.data?.tables ?? []).filter((tb) => !Object.values(TAB_GAME).includes(tb.gameId))
      : (tables.data?.tables ?? []);

  // Null while the lobby has not answered. '$ 0.00' is a claim about the pools
  // and it is the wrong one — the hero shows a skeleton instead.
  const rawJackpot = lobby.data?.totalJackpot;
  const jackpotDisplay = rawJackpot === undefined ? null : `$ ${formatMicros(rawJackpot)}`;

  const displayTables: DisplayTable[] = rawTables.map((t) => ({
    id: t.id,
    blinds: formatBlinds(t.stakes, t.smallBlind),
    players: `${t.players} / ${t.maxPlayers}`,
    // The server's own figure. It used to fall back to 40 when absent, which
    // put a buy-in on the row that the table had never quoted.
    buyIn: t.buyInBB === null ? '—' : `${t.buyInBB} BB`,
    // Null rather than a substitute. The old line read
    //   t.jackpot || t.stakes * 10
    // so a table with an empty pool advertised ten times its blind as a dollar
    // amount — invented from unrelated data, on REAL tables, not just the
    // sample ones. Nothing here may stand in for a number the server did not
    // send.
    jackpot: t.jackpot > 0 ? t.jackpot : null,
    isFull: t.status === 'FULL' || t.players >= t.maxPlayers,
    youAreSeated: t.youAreSeated === true,
    stakes: t.stakes,
  }));

  const handleQuickJoin = () => {
    const available = displayTables.find((t) => !t.isFull) || displayTables[0];
    if (available) {
      navigate(`/table/${available.id}`);
    }
  };

  return (
    <div className="flex flex-col space-y-3.5 pb-4">
      <ContextBanner />

      {/* Jackpot hero - exact match with in-game / Games page */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-5 text-center flex flex-col justify-center h-32"
        style={{ boxShadow: 'var(--glow-brand)' }}
      >
        <div className="absolute inset-0" style={{ backgroundImage: 'var(--brand-gradient)', opacity: 0.9 }} />
        <img 
          src="/brand/trophy.png" 
          alt="Grand Jackpot Trophy" 
          className="absolute left-2 top-1/2 -translate-y-1/2 h-[115%] w-auto object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)] z-10 pointer-events-none" 
        />
        <motion.div
          className="absolute inset-y-0 w-1/3 bg-white/20 blur-2xl"
          initial={{ x: '-120%' }}
          animate={{ x: '360%' }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.5 }}
        />
        <div className="relative text-white z-10 flex flex-col items-center pl-20">
          <div className="text-[0.7rem] font-bold uppercase tracking-wider text-white/90">
            {t('lobby.grandJackpot')}
          </div>
          {lobby.isPending ? (
            <div className="mt-1 flex justify-center">
              <Skeleton className="h-10 w-52 bg-white/25" />
            </div>
          ) : (
            <div className="mt-0.5 text-[2.2rem] font-black leading-none tracking-tight tabular-nums text-yellow-400 drop-shadow-sm">
              {/* An em dash when the pools are unknown. A jackpot is the one
                  number on this screen a player might act on, and "$ 0.00"
                  would be a statement that there is nothing to win. */}
              {jackpotDisplay ?? '—'}
            </div>
          )}
        </div>
      </div>

      {/* Game Type Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        {VARIANTS.map((v) => {
          const active = variant === v.id;
          return (
            <button
              key={v.id}
              onClick={() => setVariant(v.id)}
              className={cn(
                'px-3.5 py-2 text-xs font-black tracking-wider transition-all rounded-lg shrink-0',
                active
                  ? 'bg-[#0f3922] border border-[#22c55e] text-[#22c55e] shadow-[0_0_12px_rgba(34,197,94,0.25)]'
                  : 'bg-surface-2/60 text-dim border border-transparent hover:text-text',
              )}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      {/* Stakes Filter Pills */}
      <div className="flex items-center justify-between gap-1.5 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1.5">
          {STAKES_OPTIONS.map((s) => {
            const active = blinds === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setBlinds(s.id)}
                className={cn(
                  'px-3 py-1.5 text-xs font-bold transition-all rounded-md shrink-0',
                  active
                    ? 'bg-[#15803d] text-white shadow-xs'
                    : 'bg-surface-2/80 text-dim hover:text-text',
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {/* Was inert. Toggles the one filter a player in a lobby actually
            wants — hide tables they cannot sit at — which the API already
            supports via hasSeats. */}
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
              ? 'border-[#22c55e] bg-[#0f3922] text-[#22c55e]'
              : 'border-border bg-surface-2 text-dim hover:text-text',
          )}
        >
          <SlidersHorizontal size={14} />
        </button>
      </div>

      {/* Table List Grid */}
      <div className="overflow-hidden rounded-xl border border-border/80 bg-surface/90 shadow-sm">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border/60 text-[0.65rem] text-dim uppercase tracking-wider">
              <th className="px-3 py-2.5 font-bold">Table</th>
              <th className="px-3 py-2.5 font-bold">Blinds</th>
              <th className="px-3 py-2.5 font-bold">Players</th>
              <th className="px-3 py-2.5 font-bold">Buy-in</th>
              <th className="px-3 py-2.5 text-right font-bold">Status</th>
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
              // An unreachable lobby is not an empty one. Saying "no tables
              // found" when the request failed tells the player the platform
              // is dead rather than that we could not ask.
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
                  <td className="px-3 py-3 font-bold text-[#eab308]">
                    {tbl.id}
                    {/* The row holding this player's seat. It is the reason every
                        other table is refusing them, and the only row that can
                        release it — so it is marked next to the name rather than
                        buried in the status column. */}
                    {tbl.youAreSeated && (
                      <span className="ml-2 rounded-full bg-brand/20 px-2 py-0.5 text-[0.6rem] font-bold text-brand align-middle">
                        {t('lobby.yourSeat')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-dim font-medium">{tbl.blinds}</td>
                  <td className="px-3 py-3 tabular-nums font-semibold text-text">{tbl.players}</td>
                  <td className="px-3 py-3 tabular-nums text-dim font-medium">{tbl.buyIn}</td>
                  <td className="px-3 py-3 text-right">
                    {tbl.isFull ? (
                      <span className="inline-block min-w-16 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-center text-[0.7rem] font-bold text-dim">
                        {t('lobby.wait')}
                      </span>
                    ) : tbl.jackpot !== null ? (
                      <span className="inline-block min-w-16 rounded-md border border-[#22c55e]/40 bg-[#064e3b]/80 px-2.5 py-1 text-center text-[0.7rem] font-bold text-[#4ade80] shadow-xs">
                        ${formatMicros(tbl.jackpot, 0)}
                      </span>
                    ) : (
                      // Open, but with no pool to advertise. Say the table is
                      // open rather than print a dollar sign next to nothing.
                      <span className="inline-block min-w-16 rounded-md border border-[#22c55e]/40 bg-[#064e3b]/80 px-2.5 py-1 text-center text-[0.7rem] font-bold text-[#4ade80] shadow-xs">
                        {t('lobby.open')}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Action Buttons: Quick Join & Create Private Table */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleQuickJoin}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#16a34a] hover:bg-[#15803d] py-3 px-4 text-sm font-black text-white shadow-lg shadow-green-950/40 active:scale-[0.98] transition-all"
        >
          <Zap size={18} className="fill-current text-white" />
          QUICK JOIN
        </button>
        {/* Live again, but as a signpost rather than a creator.

            A private table is a LEAGUE room (v5.9 §2: "league tables visible
            only to league members, completely invisible to lobby players") and
            only that league's owner or an admin may open one. So a creator here
            would be a control almost nobody looking at it can use. This routes
            to the alliance tab, where the control belongs, and says why — which
            is also the answer for a player who is not in an alliance yet. */}
        <button
          onClick={() => {
            haptic('light');
            toast.info(t('lobby.createPrivateHint'));
            navigate('/alliance');
          }}
          title={t('lobby.createPrivateHint')}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-2 py-3 px-3 text-xs font-bold text-text transition-all active:scale-[0.98]"
        >
          <Plus size={16} className="text-brand" />
          {t('lobby.createPrivate')}
        </button>
      </div>
    </div>
  );
}


