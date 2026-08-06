import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Trophy, Zap, SlidersHorizontal, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useLobbyGames, useLobbyTables } from '@/api/hooks';
import { HIDDEN_GAMES } from '@/lib/games';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';
import type { TableView } from '@/api/lobby';

/**
 * Tab 3 — Lobby, to the approved design: grand jackpot, game-type tabs, stake
 * chips, and a table list you scan like a fixture board.
 *
 * The table list is the point of this screen. A player choosing where to sit
 * compares blinds, how full a table is and how deep the money is — so those are
 * columns, not prose, and the numbers are tabular so they line up down the page.
 */

/** micro-USD → dollars. The server speaks micros everywhere; the UI never does. */
const usd = (micros: number): number => micros / 1_000_000;

const money = (micros: number, dp = 2): string =>
  usd(micros).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** Blinds read as a pair — the small blind is conventionally half the big. */
const blinds = (stakes: number): string => {
  const big = usd(stakes);
  const small = big / 2;
  const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));
  return `${fmt(small)}/${fmt(big)}`;
};

/**
 * Game-type tabs.
 *
 * DEZHOU (德州) is Texas and AUSHA is Omaha — those are unambiguous. XUZHOU and
 * MACAU are in the design but match no game in the server catalog, so they are
 * declared with a null gameId: the tab renders and reports honestly that it has
 * no tables rather than silently showing another game's. Confirm with Victor and
 * fill in the id — that is the whole change.
 */
const GAME_TABS: { key: string; gameId: string | null }[] = [
  { key: 'dezhou', gameId: 'texas' },
  { key: 'xuzhou', gameId: null },
  { key: 'ausha', gameId: 'omaha' },
  { key: 'macau', gameId: null },
  { key: 'others', gameId: null },
];

/** Stake buckets, in dollars of big blind. */
const STAKES: { key: string; min?: number; max?: number }[] = [
  { key: 'all' },
  { key: '1/2', min: 2, max: 2 },
  { key: '5/10', min: 10, max: 10 },
  { key: '25/50', min: 50, max: 50 },
  { key: '100/200', min: 200, max: 200 },
];

export function Lobby() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState('dezhou');
  const [stake, setStake] = useState('all');

  const games = useLobbyGames();
  const activeTab = GAME_TABS.find((g) => g.key === tab)!;
  const bucket = STAKES.find((s) => s.key === stake)!;

  const tables = useLobbyTables({
    ...(activeTab.gameId ? { gameId: activeTab.gameId } : {}),
    ...(bucket.min !== undefined ? { minStakes: bucket.min * 1_000_000 } : {}),
    ...(bucket.max !== undefined ? { maxStakes: bucket.max * 1_000_000 } : {}),
  });

  const rows = useMemo(
    () => (tables.data?.tables ?? []).filter((tb) => !HIDDEN_GAMES.has(tb.gameId)),
    [tables.data],
  );

  const totalJackpot = games.data?.totalJackpot ?? 0;

  // A tab the catalog has no game for can't have tables — say so, rather than
  // showing an empty list that reads as "no tables right now".
  const unmappedTab = activeTab.gameId === null && tab !== 'others';

  return (
    <div className="space-y-4">
      {/* Grand jackpot */}
      <div
        onClick={() => { haptic('light'); navigate('/jackpot'); }}
        className="relative cursor-pointer overflow-hidden rounded-(--radius-app) border border-jackpot/30 bg-jackpot/10 p-4 active:scale-[0.99]"
      >
        <motion.div
          className="pointer-events-none absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/10 to-transparent"
          animate={{ x: ['-100%', '200%'] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.5 }}
        />
        <div className="relative flex items-center gap-3">
          <Trophy size={34} className="shrink-0 text-jackpot" />
          <div className="min-w-0">
            <div className="text-[0.66rem] font-bold uppercase tracking-widest text-jackpot/80">
              {t('lobby.grandJackpot')}
            </div>
            <div className="truncate text-2xl font-black tabular-nums text-jackpot">
              ₮{money(totalJackpot)}
            </div>
          </div>
          <span className="ml-auto shrink-0 self-start rounded-full bg-success/15 px-2 py-1 text-[0.6rem] font-bold text-success">
            <ShieldCheck size={11} className="mr-1 inline align-[-1px]" />
            {t('lobby.fairSecure')}
          </span>
        </div>
      </div>

      {/* Game-type tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {GAME_TABS.map((g) => (
          <button
            key={g.key}
            onClick={() => {
              haptic('light');
              setTab(g.key);
            }}
            className={cn(
              'shrink-0 border-b-2 px-3 pb-2 text-xs font-bold uppercase tracking-wide transition-colors',
              tab === g.key ? 'border-brand text-brand' : 'border-transparent text-dim',
            )}
          >
            {t(`lobby.tab.${g.key}`)}
          </button>
        ))}
      </div>

      {/* Stake chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        {STAKES.map((s) => (
          <button
            key={s.key}
            onClick={() => {
              haptic('light');
              setStake(s.key);
            }}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors',
              stake === s.key ? 'bg-brand text-white' : 'border border-border bg-surface text-dim',
            )}
          >
            {s.key === 'all' ? t('games.filterAll') : s.key}
          </button>
        ))}
        <div className="ml-auto shrink-0 rounded-full border border-border bg-surface p-2 text-dim">
          <SlidersHorizontal size={14} />
        </div>
      </div>

      {/* Table list */}
      <section>
        <div className="grid grid-cols-[1.1fr_1fr_0.9fr_1fr_1.1fr] gap-2 px-3 pb-2 text-[0.6rem] font-bold uppercase tracking-wide text-dim">
          <span>{t('lobby.colTable')}</span>
          <span>{t('lobby.colBlinds')}</span>
          <span>{t('lobby.colPlayers')}</span>
          <span>{t('lobby.colBuyIn')}</span>
          <span className="text-right">{t('lobby.colStatus')}</span>
        </div>

        {tables.isPending && (
          <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="px-3 py-3">
                <Skeleton className="h-3.5 w-full" />
              </div>
            ))}
          </div>
        )}

        {!tables.isPending && (unmappedTab || rows.length === 0) && (
          <div className="rounded-(--radius-app) border border-border bg-surface">
            <EmptyState
              icon={SlidersHorizontal}
              title={unmappedTab ? t('lobby.tabNotMapped') : t('lobby.noTables')}
              description={unmappedTab ? undefined : t('lobby.noTablesBlurb')}
            />
          </div>
        )}

        {!tables.isPending && !unmappedTab && rows.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
            {rows.map((tb) => (
              <TableRow key={tb.id} table={tb} onJoin={() => navigate(`/table/${tb.gameId}`)} />
            ))}
          </ul>
        )}
      </section>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          className="flex-1"
          onClick={() => {
            haptic('medium');
            const first = rows.find((r) => r.seatsFree > 0) ?? rows[0];
            if (first) navigate(`/table/${first.gameId}`);
          }}
          disabled={rows.length === 0}
        >
          <Zap size={16} className="mr-1.5" />
          {t('lobby.quickJoin')}
        </Button>
        <Button variant="ghost" className="flex-1" onClick={() => haptic('light')}>
          {t('lobby.createPrivate')}
        </Button>
      </div>
    </div>
  );
}

function TableRow({ table, onJoin }: { table: TableView; onJoin: () => void }) {
  const { t } = useTranslation();
  // A table you can sit at shows what is in its pot; one you cannot shows why.
  const joinable = table.status === 'OPEN' && table.seatsFree > 0;

  return (
    <li>
      <button
        onClick={() => {
          haptic('light');
          onJoin();
        }}
        className="grid w-full grid-cols-[1.1fr_1fr_0.9fr_1fr_1.1fr] items-center gap-2 px-3 py-3 text-left text-xs tabular-nums active:bg-surface-2"
      >
        <span className="truncate font-bold text-jackpot">{table.id.toUpperCase()}</span>
        <span className="truncate">{blinds(table.stakes)}</span>
        <span className={cn('truncate', table.seatsFree === 0 && 'text-dim')}>
          {table.players}/{table.maxPlayers}
        </span>
        <span className="truncate text-dim">{table.buyInBB} BB</span>
        <span className="justify-self-end">
          {joinable ? (
            <span className="rounded-full bg-success/15 px-2 py-1 text-[0.62rem] font-bold text-success">
              ₮{money(table.jackpot, 0)}
            </span>
          ) : (
            <span className="rounded-full bg-surface-2 px-2 py-1 text-[0.62rem] font-bold text-dim">
              {t(`lobby.status.${table.status.toLowerCase()}`)}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
