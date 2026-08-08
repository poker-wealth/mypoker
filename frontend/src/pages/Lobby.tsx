import { useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { useLobbyGames, useTables } from '@/api/hooks';
import { formatMicros } from '@/api/lobby';

export function Lobby() {
  const navigate = useNavigate();
  const lobby = useLobbyGames();
  const [variant, setVariant] = useState('dezhou');
  const [blinds, setBlinds] = useState('all');

  const stakesMap: Record<string, number | undefined> = {
    'all': undefined,
    '1/2': 2_000_000,
    '5/10': 10_000_000,
    '25/50': 50_000_000,
    '100/200': 200_000_000,
  };
  const targetStakes = stakesMap[blinds];

  const { data: tablesData } = useTables({
    gameId: variant === 'dezhou' ? 'texas' : variant === 'ausha' ? 'omaha' : variant === 'all' ? undefined : variant,
    minStakes: targetStakes,
    maxStakes: targetStakes,
  });

  // Null while loading rather than the mockup's placeholder figure. Showing
  // $1,253,842.28 before the server answers presents a number from a design
  // document as this platform's actual jackpot.
  const jackpot = lobby.data ? `$ ${formatMicros(lobby.data.totalJackpot)}` : null;

  const tables = tablesData?.tables || [];

  return (
    <div className="flex h-full flex-col space-y-4">
      {/* Header removed and moved to Header.tsx */}

      {/* Jackpot hero */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-5 text-center flex flex-col justify-center h-32"
        style={{ boxShadow: 'var(--glow-brand)' }}
      >
        <div className="absolute inset-0" style={{ backgroundImage: 'var(--brand-gradient)', opacity: 0.9 }} />
        <img 
          src="/brand/jackpot.png" 
          alt="Jackpot" 
          className="absolute left-0 top-0 h-full object-cover mix-blend-screen opacity-90" 
          style={{ maskImage: 'linear-gradient(to right, black 50%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black 50%, transparent 100%)' }}
        />
        <motion.div
          className="absolute inset-y-0 w-1/3 bg-white/20 blur-2xl"
          initial={{ x: '-120%' }}
          animate={{ x: '360%' }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.5 }}
        />
        <div className="relative text-white z-10 flex flex-col items-center pl-10">
          <div className="text-[0.7rem] font-bold uppercase tracking-wider text-white/90">
            Grand Jackpot
          </div>
          {lobby.isPending ? (
            <div className="mt-1 flex justify-center">
              <Skeleton className="h-10 w-52 bg-white/25" />
            </div>
          ) : (
            <div className="mt-0.5 text-[2.2rem] font-black leading-none tracking-tight tabular-nums text-yellow-400 drop-shadow-sm">
              {jackpot}
            </div>
          )}
          {/* The mockup's '+ $322.16 / hr' is removed rather than kept: nothing
              computes an accrual rate, so it would be a financial figure invented
              by a design document and shown to players as this pool's real growth. */}
        </div>
      </div>

      <Segmented
        value={variant}
        onChange={setVariant}
        // XUZHOU and MACAU appeared in the mockup but in no document and no
        // server catalog. Victor's ruling (Aug 8): follow the documentation —
        // so the tabs are the games that exist.
        options={[
          { value: 'dezhou', label: 'DEZHOU' },
          { value: 'ausha', label: 'AUSHA' },
          { value: 'short-deck', label: 'SHORT DECK' },
          { value: 'others', label: 'OTHERS' },
        ]}
      />

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Segmented
            value={blinds}
            onChange={setBlinds}
            options={[
              { value: 'all', label: 'ALL' },
              { value: '1/2', label: '1/2' },
              { value: '5/10', label: '5/10' },
              { value: '25/50', label: '25/50' },
              { value: '100/200', label: '100/200' },
            ]}
          />
        </div>
      </div>

      {/* Table list */}
      <div className="flex-1 overflow-auto rounded-(--radius-app) border border-border bg-surface">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border/50 text-[0.65rem] text-dim">
              <th className="px-3 py-2.5 font-medium">Table</th>
              <th className="px-3 py-2.5 font-medium">Blinds</th>
              <th className="px-3 py-2.5 font-medium">Players</th>
              <th className="px-3 py-2.5 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {tables.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-dim">
                  No tables found
                </td>
              </tr>
            ) : (
              tables.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => navigate(`/table/${t.id}`)}
                  className="cursor-pointer transition-colors active:bg-surface-2 hover:bg-surface-2/50"
                >
                  <td className="px-3 py-3 font-semibold text-yellow-500">{t.name.split('·')[0].trim()}</td>
                  <td className="px-3 py-3 tabular-nums text-dim">
                    {formatMicros(t.stakes / 2, 0)}/{formatMicros(t.stakes, 0)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{t.players}/{t.maxPlayers}</td>
                  <td className="px-3 py-3 text-right">
                    <span
                      className={`font-semibold ${t.status === 'OPEN' || t.status === 'WAITING' ? 'text-success' : 'text-dim'
                        }`}
                    >
                      {t.status === 'WAITING' ? 'WAIT' : t.status === 'FULL' ? 'FULL' : 'PLAY'}
                    </span>
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

