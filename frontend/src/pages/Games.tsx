import { useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Segmented } from '@/components/ui/Segmented';
import { GameTile } from '@/components/GameTile';
import { TableEntryModal } from '@/components/TableEntryModal';
import { visibleGames, type GameCategory, type GameDef } from '@/lib/games';
import { useLobbyGames } from '@/api/hooks';

type Filter = 'all' | GameCategory;

const COMING_SOON = ['blackjack', 'sicbo', 'fishingWar', 'setteMezzo'];

export function Games() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [cat, setCat] = useState<Filter>('all');
  const [q, setQ] = useState('');
  // Hold'em taps open the join-or-create modal instead of going straight to
  // felt (owner-approved). Other games still navigate directly.
  const [entryOpen, setEntryOpen] = useState(false);

  const lobby = useLobbyGames();

  // Live figures per game, keyed by id. The tiles take their table count and
  // jackpot from here; nothing on this screen comes from the static catalog
  // except artwork, names and categories.
  const live = new Map((lobby.data?.games ?? []).map((g) => [g.gameId, g]));

  const query = q.trim().toLowerCase();

  // visibleGames(), NOT GAMES: the launch gate (HIDDEN_GAMES, withheld on
  // Victor's instruction) lives in that filter, and iterating the raw list
  // here rendered withheld games as tappable tiles that navigated to real
  // tables. An audit caught this page as the one map site bypassing the gate.
  const games = visibleGames();
  const grouped = {
    poker: games.filter(g => g.category === 'poker'),
    card: games.filter(g => g.category === 'card'),
    quick: games.filter(g => g.category === 'quick' || g.category === 'arcade'),
  };

  const getShown = (list: GameDef[]) => {
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
                <GameTile
                  key={g.id}
                  game={g}
                  tables={live.get(g.id)?.tables}
                  jackpot={live.get(g.id)?.jackpot}
                  onClick={() =>
                    g.id === 'texas' ? setEntryOpen(true) : navigate(`/table/${g.id}`)
                  }
                />
              ))}
            </div>
          </section>
        )}

        {getShown(grouped.card).length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-bold text-white tracking-wider">CARD GAMES</h2>
            <div className="grid grid-cols-3 gap-2">
              {getShown(grouped.card).map((g) => (
                <GameTile
                  key={g.id}
                  game={g}
                  tables={live.get(g.id)?.tables}
                  jackpot={live.get(g.id)?.jackpot}
                  onClick={() => navigate(`/table/${g.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {getShown(grouped.quick).length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-bold text-white tracking-wider">QUICK GAMES</h2>
            <div className="grid grid-cols-3 gap-2">
              {getShown(grouped.quick).map((g) => (
                <GameTile
                  key={g.id}
                  game={g}
                  tables={live.get(g.id)?.tables}
                  jackpot={live.get(g.id)?.jackpot}
                  onClick={() => navigate(`/table/${g.id}`)}
                />
              ))}
            </div>
          </section>
        )}
        
        {getShown(games).length === 0 && (
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

      <TableEntryModal open={entryOpen} onClose={() => setEntryOpen(false)} />
    </div>
  );
}
