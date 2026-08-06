import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Search, Trophy, MoreHorizontal } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useLobbyGames } from '@/api/hooks';
import { GAMES, CATEGORIES, HIDDEN_GAMES, gameVisual, type GameCategory, type GameDef } from '@/lib/games';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';

/**
 * Tab 2 — Games, laid out to the approved design: a jackpot banner, category
 * chips, then one section per category with table counts and each game's
 * accumulated pot.
 *
 * Live figures come from GET /lobby/games. When it can't be reached the catalog's
 * own numbers stand in — as on the Lobby, a storefront that renders is better
 * than an error, and no personal data is involved.
 *
 * Sections render in catalog order and are skipped when empty, so a category with
 * nothing in it doesn't leave a bare heading. ARCADE has no games assigned yet;
 * its chip is present because the design shows it, and selecting it says so
 * plainly rather than showing an empty grid.
 */

type Filter = 'all' | GameCategory;

const SECTION_KEY: Record<GameCategory, string> = {
  poker: 'games.sectionPoker',
  card: 'games.sectionCard',
  arcade: 'games.sectionArcade',
  quick: 'games.sectionQuick',
};

/** Compact money for the tile's pot line — 125421.32 reads as 125,421.32. */
const money = (n: number): string =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Games() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const lobby = useLobbyGames();

  /**
   * Merge live figures onto the catalog.
   *
   * The catalog decides what is shown; the server decides the numbers. A game the
   * server reports but we don't surface (see HIDDEN_GAMES) is dropped here, and a
   * game we surface that the server doesn't mention keeps its fallback figures
   * rather than dropping to zero tables.
   */
  const games = useMemo(() => {
    const live = new Map(
      (lobby.data?.games ?? [])
        .filter((g) => !HIDDEN_GAMES.has(g.gameId))
        .map((g) => [g.gameId, g]),
    );
    return GAMES.map((g) => {
      const server = live.get(g.id);
      return server ? { ...g, tables: server.tables, players: server.players, jackpot: server.jackpot } : g;
    });
  }, [lobby.data]);

  const totalJackpot = games.reduce((sum, g) => sum + g.jackpot, 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return games.filter((g) => {
      if (filter !== 'all' && g.category !== filter) return false;
      if (!q) return true;
      // Match the translated name as well as the English one, so 牛牛 finds Niu
      // Niu and 'niu' still works.
      const translated = t(`gameNames.${g.id}`, { defaultValue: g.name }).toLowerCase();
      return translated.includes(q) || g.name.toLowerCase().includes(q);
    });
  }, [games, filter, query, t]);

  const sections = CATEGORIES.map((category) => ({
    category,
    games: visible.filter((g) => g.category === category),
  })).filter((s) => s.games.length > 0);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('games.search')}
          className="w-full rounded-full border border-border bg-surface py-2.5 pl-9 pr-3 text-sm text-text placeholder:text-dim"
        />
      </div>

      {/* Jackpot banner */}
      <div className="relative overflow-hidden rounded-(--radius-app) border border-jackpot/30 bg-jackpot/10 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <Trophy size={26} className="shrink-0 text-jackpot" />
          <div className="min-w-0">
            <div className="text-[0.66rem] font-bold uppercase tracking-widest text-jackpot/80">
              {t('lobby.jackpot')}
            </div>
            <div className="truncate text-xl font-black tabular-nums text-jackpot">
              ₮{money(totalJackpot)}
            </div>
          </div>
        </div>
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          {t('games.filterAll')}
        </Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c} active={filter === c} onClick={() => setFilter(c)}>
            {t(`games.filter.${c}`)}
          </Chip>
        ))}
      </div>

      {sections.length === 0 ? (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <EmptyState
            icon={Search}
            title={filter === 'arcade' ? t('games.noneInCategory') : t('games.noMatch')}
            {...(query ? { description: t('games.tryAnother') } : {})}
          />
        </div>
      ) : (
        sections.map(({ category, games: list }) => (
          <section key={category}>
            <h2 className="mb-2.5 px-1 text-xs font-bold uppercase tracking-wide text-dim">
              {t(SECTION_KEY[category])}
            </h2>
            <div className="grid grid-cols-3 gap-2.5">
              {list.map((g) => (
                <GameCard key={g.id} game={g} />
              ))}
              {/* The design ends the quick row with a "more" affordance. */}
              {category === 'quick' && !query && filter === 'all' && <MoreCard label={t('games.more')} />}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => {
        haptic('light');
        onClick();
      }}
      className={cn(
        'shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-colors',
        active ? 'bg-brand text-white' : 'border border-border bg-surface text-dim',
      )}
    >
      {children}
    </button>
  );
}

function GameCard({ game }: { game: GameDef }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const visual = gameVisual(game.id) ?? game;

  return (
    <button
      onClick={() => {
        haptic('light');
        navigate(`/table/${game.id}`);
      }}
      className="flex flex-col overflow-hidden rounded-(--radius-app) border border-border bg-surface text-left active:scale-[0.98]"
    >
      <div
        className="grid h-16 w-full place-items-center text-2xl"
        style={{
          backgroundImage: `linear-gradient(135deg, ${visual.gradient[0]}, ${visual.gradient[1]})`,
        }}
      >
        {visual.glyph}
      </div>
      <div className="min-w-0 px-2 py-2">
        <div className="truncate text-[0.72rem] font-bold">
          {t(`gameNames.${game.id}`, { defaultValue: game.name })}
        </div>
        <div className="mt-0.5 truncate text-[0.6rem] text-dim tabular-nums">
          {t('games.tableCount', { count: game.tables })}
        </div>
        <div className="mt-0.5 truncate text-[0.62rem] font-bold text-jackpot tabular-nums">
          ₮{money(game.jackpot)}
        </div>
      </div>
    </button>
  );
}

/** Placeholder for the design's "more games" tile. Inert until there are more. */
function MoreCard({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-(--radius-app) border border-dashed border-border bg-surface py-6 text-dim">
      <MoreHorizontal size={22} />
      <span className="text-[0.62rem] font-semibold">{label}</span>
    </div>
  );
}
