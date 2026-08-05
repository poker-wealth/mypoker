import { useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Segmented } from '@/components/ui/Segmented';
import { GameTile } from '@/components/GameTile';
import { GAMES, type GameCategory } from '@/lib/games';

type Filter = 'all' | GameCategory;

const COMING_SOON = ['blackjack', 'sicbo', 'fishingWar', 'setteMezzo'];

export function Games() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [cat, setCat] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const query = q.trim().toLowerCase();
  const shown = GAMES.filter((g) => {
    const inCat = cat === 'all' || g.category === cat;
    // Match the translated name as well as the English one, so searching "牛牛"
    // works in Chinese and "niu" still works for anyone typing latin characters.
    const localised = t(`gameNames.${g.id}`, { defaultValue: g.name }).toLowerCase();
    const inQuery = !query || g.name.toLowerCase().includes(query) || localised.includes(query);
    return inCat && inQuery;
  });

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
          { value: 'all', label: t('games.filterAll') },
          { value: 'poker', label: t('games.filterPoker') },
          { value: 'fast', label: t('games.filterFast') },
          { value: 'cards', label: t('games.filterCards') },
        ]}
      />

      {shown.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {shown.map((g) => (
            <GameTile key={g.id} game={g} onClick={() => navigate(`/table/${g.id}`)} />
          ))}
        </div>
      ) : (
        <div className="rounded-(--radius-app) border border-border bg-surface py-10 text-center text-sm text-dim">
          {t('games.noMatch', { query: q })}
        </div>
      )}

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
