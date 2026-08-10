import { useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Zap, SlidersHorizontal, Plus } from 'lucide-react';
import { useLobbyGames, useTables } from '@/api/hooks';
import { formatMicros } from '@/api/lobby';
import { ContextBanner } from '@/components/ContextBanner';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';

interface DisplayTable {
  id: string;
  code: string;
  blinds: string;
  players: string;
  buyIn: string;
  status: string;
  isFull: boolean;
  stakes: number;
  variant: string;
}

const SAMPLE_TABLES: DisplayTable[] = [
  { id: 'texas', code: 'T-001', blinds: '1/2', players: '6 / 9', buyIn: '42 BB', status: '$1,200', isFull: false, stakes: 2_000_000, variant: 'dezhou' },
  { id: 'texas-2', code: 'T-002', blinds: '1/2', players: '8 / 9', buyIn: '38 BB', status: '$980', isFull: false, stakes: 2_000_000, variant: 'dezhou' },
  { id: 'texas-3', code: 'T-003', blinds: '5/10', players: '7 / 9', buyIn: '88 BB', status: '$2,100', isFull: false, stakes: 10_000_000, variant: 'dezhou' },
  { id: 'texas-4', code: 'T-004', blinds: '5/10', players: '9 / 9', buyIn: '112 BB', status: 'WAIT', isFull: true, stakes: 10_000_000, variant: 'dezhou' },
  { id: 'texas-5', code: 'T-005', blinds: '25/50', players: '6 / 9', buyIn: '240 BB', status: '$8,900', isFull: false, stakes: 50_000_000, variant: 'dezhou' },
  { id: 'texas-6', code: 'T-006', blinds: '100/200', players: '9 / 9', buyIn: '512 BB', status: 'WAIT', isFull: true, stakes: 200_000_000, variant: 'dezhou' },
];

const VARIANTS = [
  { id: 'dezhou', label: 'DEZHOU' },
  { id: 'xuzhou', label: 'XUZHOU' },
  { id: 'ausha', label: 'AUSHA' },
  { id: 'macau', label: 'MACAU' },
  { id: 'others', label: 'OTHERS' },
];

const STAKES_OPTIONS = [
  { id: 'all', label: 'ALL', minStakes: undefined },
  { id: '1/2', label: '1/2', minStakes: 2_000_000 },
  { id: '5/10', label: '5/10', minStakes: 10_000_000 },
  { id: '25/50', label: '25/50', minStakes: 50_000_000 },
  { id: '100/200', label: '100/200', minStakes: 200_000_000 },
];

export function Lobby() {
  const navigate = useNavigate();
  const lobby = useLobbyGames();
  const [variant, setVariant] = useState('dezhou');
  const [blinds, setBlinds] = useState('all');

  const targetStakes = STAKES_OPTIONS.find((s) => s.id === blinds)?.minStakes;

  const { data: tablesData } = useTables({
    gameId: variant === 'dezhou' ? 'texas' : variant === 'ausha' ? 'omaha' : variant === 'all' ? undefined : variant,
    minStakes: targetStakes,
    maxStakes: targetStakes,
  });

  const rawJackpot = lobby.data?.totalJackpot;
  const jackpotDisplay = rawJackpot ? `$ ${formatMicros(rawJackpot)}` : '$ 1,253,842.28';

  const backendTables = tablesData?.tables || [];
  const displayTables: DisplayTable[] =
    backendTables.length > 0
      ? backendTables.map((t, idx) => ({
          id: t.id,
          code: `T-00${idx + 1}`,
          blinds: `${formatMicros(t.stakes / 2, 0)}/${formatMicros(t.stakes, 0)}`,
          players: `${t.players} / ${t.maxPlayers}`,
          buyIn: `${t.buyInBB || 40} BB`,
          status: t.status === 'FULL' ? 'WAIT' : t.status === 'WAITING' ? 'WAIT' : `$${formatMicros(t.jackpot || t.stakes * 10, 0)}`,
          isFull: t.status === 'FULL' || t.players >= t.maxPlayers,
          stakes: t.stakes,
          variant: t.gameId,
        }))
      : SAMPLE_TABLES.filter((t) => (blinds === 'all' ? true : t.blinds === blinds));

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
          src="/brand/unnamed.png" 
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
            Grand Jackpot
          </div>
          {lobby.isPending ? (
            <div className="mt-1 flex justify-center">
              <Skeleton className="h-10 w-52 bg-white/25" />
            </div>
          ) : (
            <div className="mt-0.5 text-[2.2rem] font-black leading-none tracking-tight tabular-nums text-yellow-400 drop-shadow-sm">
              {jackpotDisplay}
            </div>
          )}
          <div className="mt-1 text-xs font-bold text-success drop-shadow-sm">+ $322.16 / hr</div>
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
        <button
          aria-label="Filter"
          className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-dim hover:text-text active:scale-95"
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
            {displayTables.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-dim">
                  No tables found
                </td>
              </tr>
            ) : (
              displayTables.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => navigate(`/table/${t.id}`)}
                  className="cursor-pointer transition-colors active:bg-surface-2/80 hover:bg-surface-2/40"
                >
                  <td className="px-3 py-3 font-bold text-[#eab308]">{t.code}</td>
                  <td className="px-3 py-3 tabular-nums text-dim font-medium">{t.blinds}</td>
                  <td className="px-3 py-3 tabular-nums font-semibold text-text">{t.players}</td>
                  <td className="px-3 py-3 tabular-nums text-dim font-medium">{t.buyIn}</td>
                  <td className="px-3 py-3 text-right">
                    {t.isFull ? (
                      <span className="inline-block min-w-16 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-center text-[0.7rem] font-bold text-dim">
                        WAIT
                      </span>
                    ) : (
                      <span className="inline-block min-w-16 rounded-md border border-[#22c55e]/40 bg-[#064e3b]/80 px-2.5 py-1 text-center text-[0.7rem] font-bold text-[#4ade80] shadow-xs">
                        {t.status}
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
        <button
          onClick={() => navigate('/table/texas')}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface hover:bg-surface-2 py-3 px-3 text-xs font-bold text-text active:scale-[0.98] transition-all"
        >
          <Plus size={16} className="text-dim" />
          CREATE PRIVATE TABLE
        </button>
      </div>
    </div>
  );
}


