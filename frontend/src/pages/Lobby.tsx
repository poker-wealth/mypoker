import { motion } from 'motion/react';
import { ShieldCheck, Flame, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GameTile } from '@/components/GameTile';
import { Skeleton } from '@/components/ui/Skeleton';
import { GAMES, gameVisual, totalPlayers, type GameDef } from '@/lib/games';
import { useLobbyGames } from '@/api/hooks';
import { formatMicros } from '@/api/lobby';

/**
 * The lobby.
 *
 * Reads live figures from GET /lobby/games and **falls back to the static
 * catalog** when that can't be reached — deliberately, not as an oversight. This
 * is the shop window: a player opening the app on a flaky train connection
 * should see games, not an error panel. The fallback shows plausible tiles that
 * still navigate; the only thing lost is that the numbers are stale.
 *
 * Jackpot and player counts are the two things that must be real when the server
 * is up, so they're the ones driven by the query.
 */
export function Lobby() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const lobby = useLobbyGames();

  // Merge server truth with client visuals: the server owns who's playing and
  // how big the jackpot is, we own what a game looks like.
  const games: GameDef[] = lobby.data
    ? lobby.data.games.flatMap((g): GameDef[] => {
        // Unavailable games are dropped rather than greyed out — a vendor being
        // down is our problem, not something to advertise on the front screen.
        if (!g.available) return [];
        // A game the server knows about but we have no artwork for is skipped
        // rather than rendered blank. It reappears the moment a tile is added.
        const visual = gameVisual(g.gameId);
        if (!visual) return [];
        return [{ ...visual, players: g.players, hot: g.players > 500 }];
      })
    : GAMES;

  const hot = games.filter((g) => g.hot);
  const rest = games.filter((g) => !g.hot);

  const jackpot = lobby.data ? `₮${formatMicros(lobby.data.totalJackpot)}` : '₮128,450';
  const online = lobby.data
    ? lobby.data.games.reduce((sum, g) => sum + g.players, 0)
    : totalPlayers();

  return (
    <div className="space-y-5">
      {/* Jackpot hero */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-5"
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
          <div className="flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-white/80">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70" />
              <span className="relative inline-flex size-2 rounded-full bg-white" />
            </span>
            {t('lobby.dailyJackpot')}
          </div>
          {lobby.isPending ? (
            <Skeleton className="mt-2 h-10 w-52 bg-white/25" />
          ) : (
            <div className="mt-1 text-[2.6rem] font-black leading-none tracking-tight tabular-nums">
              {jackpot}
            </div>
          )}
          <div className="mt-2 text-xs text-white/75">{t('lobby.jackpotBlurb')}</div>
        </div>
      </div>

      {/* Live players band */}
      <div className="flex items-center justify-between rounded-(--radius-app) border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck size={18} className="text-accent" />
          <span className="text-dim">{t('lobby.provablyFair')}</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <span className="size-2 rounded-full bg-success" />
          {lobby.isPending ? (
            <Skeleton className="h-4 w-10" />
          ) : (
            online.toLocaleString()
          )}
          <span className="text-dim">{t('common.online')}</span>
        </div>
      </div>

      {/* Hot now */}
      {hot.length > 0 && (
        <section>
          <div className="mb-2.5 flex items-center gap-1.5">
            <Flame size={16} className="text-danger" />
            <h2 className="text-sm font-bold">{t('lobby.hotNow')}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {hot.map((g) => (
              <GameTile key={g.id} game={g} onClick={() => navigate(`/table/${g.id}`)} />
            ))}
          </div>
        </section>
      )}

      {/* All games */}
      <section>
        <button
          onClick={() => navigate('/games')}
          className="mb-2.5 flex w-full items-center justify-between"
        >
          <h2 className="text-sm font-bold">{t('lobby.moreGames')}</h2>
          <span className="flex items-center text-xs text-dim">
            {t('common.seeAll')} <ChevronRight size={14} />
          </span>
        </button>
        <div className="grid grid-cols-2 gap-3">
          {rest.map((g) => (
            <GameTile key={g.id} game={g} onClick={() => navigate(`/table/${g.id}`)} />
          ))}
        </div>
      </section>
    </div>
  );
}
