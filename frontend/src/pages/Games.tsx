import { useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Segmented } from '@/components/ui/Segmented';
import { GameTile } from '@/components/GameTile';
import { GAMES, type GameCategory } from '@/lib/games';

type Filter = 'all' | GameCategory | 'arcade' | 'quick';

export function Games() {
  const navigate = useNavigate();
  const [cat, setCat] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const filterGames = (category: string) => {
    return GAMES.filter((g) => {
      // Map screenshot categories to existing ones or just match all if not specific enough
      const inCat = category === 'all' || 
                   (category === 'poker' && g.category === 'poker') ||
                   (category === 'cards' && g.category === 'cards') ||
                   (category === 'quick' && g.category === 'fast');
      const inQuery = g.name.toLowerCase().includes(q.trim().toLowerCase());
      return inCat && inQuery;
    });
  };

  const shown = filterGames(cat);
  
  const pokerGames = filterGames('poker');
  const cardGames = filterGames('cards');
  const quickGames = filterGames('quick');

  return (
    <div className="space-y-4">


      {/* Search */}
      <div className="flex items-center gap-2 rounded-(--radius-app) border border-border bg-surface px-3.5 py-2.5">
        <Search size={17} className="shrink-0 text-dim" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search games"
          className="w-full bg-transparent text-sm text-text placeholder:text-dim focus:outline-none"
        />
      </div>

      {/* Jackpot hero */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-5 text-center"
        style={{ boxShadow: 'var(--glow-brand)' }}
      >
        <div className="absolute inset-0" style={{ backgroundImage: 'var(--brand-gradient)', opacity: 0.9 }} />
        <motion.div
          className="absolute inset-y-0 w-1/3 bg-white/20 blur-2xl"
          initial={{ x: '-120%' }}
          animate={{ x: '360%' }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.5 }}
        />
        <div className="relative text-white">
          <div className="text-[0.7rem] font-bold uppercase tracking-wider text-white/80">
            Jackpot
          </div>
          <div className="mt-0.5 text-[2.2rem] font-black leading-none tracking-tight tabular-nums text-yellow-400">
            $ 1,253,842.28
          </div>
        </div>
      </div>

      <Segmented
        value={cat}
        onChange={setCat}
        options={[
          { value: 'all', label: 'All' },
          { value: 'poker', label: 'Poker' },
          { value: 'cards', label: 'Card' },
          { value: 'arcade', label: 'Arcade' },
          { value: 'quick', label: 'Quick' },
        ]}
      />

      {cat === 'all' && q === '' ? (
        <div className="space-y-6">
          {pokerGames.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-sm font-bold uppercase text-dim">Poker Games</h2>
              <div className="grid grid-cols-2 gap-3">
                {pokerGames.map((g) => (
                  <GameTile key={g.id} game={g} onClick={() => navigate(`/table/${g.id}`)} />
                ))}
              </div>
            </section>
          )}
          {cardGames.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-sm font-bold uppercase text-dim">Card Games</h2>
              <div className="grid grid-cols-2 gap-3">
                {cardGames.map((g) => (
                  <GameTile key={g.id} game={g} onClick={() => navigate(`/table/${g.id}`)} />
                ))}
              </div>
            </section>
          )}
          {quickGames.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-sm font-bold uppercase text-dim">Quick Games</h2>
              <div className="grid grid-cols-2 gap-3">
                {quickGames.map((g) => (
                  <GameTile key={g.id} game={g} onClick={() => navigate(`/table/${g.id}`)} />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : shown.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {shown.map((g) => (
            <GameTile key={g.id} game={g} onClick={() => navigate(`/table/${g.id}`)} />
          ))}
        </div>
      ) : (
        <div className="rounded-(--radius-app) border border-border bg-surface py-10 text-center text-sm text-dim">
          No games match.
        </div>
      )}
    </div>
  );
}
