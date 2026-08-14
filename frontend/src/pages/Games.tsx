import { useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { GameTile } from '@/components/GameTile';
import { GAMES, type GameCategory } from '@/lib/games';
import { useLobbyGames } from '@/api/hooks';
import { formatMicros } from '@/api/lobby';

type Filter = 'all' | GameCategory;

const COMING_SOON = ['blackjack', 'sicbo', 'fishingWar', 'setteMezzo'];

export function Games() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [cat, setCat] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const lobby = useLobbyGames();
  const jackpot = lobby.data ? `$ ${formatMicros(lobby.data.totalJackpot)}` : '$ 0.00';

  const query = q.trim().toLowerCase();
  
  // Group games by category
  const grouped = {
    poker: GAMES.filter(g => g.category === 'poker'),
    card: GAMES.filter(g => g.category === 'card'),
    quick: GAMES.filter(g => g.category === 'quick' || g.category === 'arcade'),
  };

  const getShown = (list: typeof GAMES) => {
    return list.filter((g) => {
      const inCat = cat === 'all' || g.category === cat;
      const localised = t(`gameNames.${g.id}`, { defaultValue: g.name }).toLowerCase();
      const inQuery = !query || g.name.toLowerCase().includes(query) || localised.includes(query);
      return inCat && inQuery;
    });
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex items-center gap-2 rounded-(--radius-app) border border-border bg-surface px-3.5 py-2.5">
        <Search size={17} className="shrink-0 text-dim" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('games.searchPlaceholder')}
          className="w-full bg-transparent text-sm text-text placeholder:text-dim focus:outline-none"
        />
      </div>

      {/* Jackpot hero */}
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
        </div>
      </div>

      <Segmented
        value={cat}
        onChange={setCat}
        options={[
          { value: 'all', label: 'ALL' },
          { value: 'poker', label: 'POKER' },
          { value: 'card', label: 'CARD' },
          { value: 'arcade', label: 'ARCADE' },
          { value: 'quick', label: 'QUICK' },
        ]}
      />

      {/* Game Sections */}
      <div className="space-y-6">
        {getShown(grouped.poker).length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-bold text-white tracking-wider">POKER GAMES</h2>
            <div className="grid grid-cols-3 gap-2">
              {getShown(grouped.poker).map((g) => (
                <GameTile key={g.id} game={g} onClick={() => navigate(`/table/${g.id}`)} />
              ))}
            </div>
          </section>
        )}

        {getShown(grouped.card).length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-bold text-white tracking-wider">CARD GAMES</h2>
            <div className="grid grid-cols-3 gap-2">
              {getShown(grouped.card).map((g) => (
                <GameTile key={g.id} game={g} onClick={() => navigate(`/table/${g.id}`)} />
              ))}
            </div>
          </section>
        )}

        {getShown(grouped.quick).length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-bold text-white tracking-wider">QUICK GAMES</h2>
            <div className="grid grid-cols-3 gap-2">
              {getShown(grouped.quick).map((g) => (
                <GameTile key={g.id} game={g} onClick={() => navigate(`/table/${g.id}`)} />
              ))}
            </div>
          </section>
        )}
        
        {getShown(GAMES).length === 0 && (
          <div className="rounded-(--radius-app) border border-border bg-surface py-10 text-center text-sm text-dim">
            {t('games.noMatch', { query: q })}
          </div>
        )}
      </div>

      {/* Coming soon */}
      <section className="pt-1">
        <h2 className="mb-2.5 text-sm font-bold text-dim">{t('games.comingSoon')}</h2>
        <div className="grid grid-cols-2 gap-3">
          {COMING_SOON.map((id) => (
            <div
              key={id}
              className="flex h-20 items-center justify-between rounded-(--radius-app) border border-dashed border-border bg-surface/50 px-4"
            >
              <span className="text-sm font-semibold text-dim">{t(`gameNames.${id}`)}</span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.6rem] font-bold text-dim">
                {t('games.soonBadge')}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
