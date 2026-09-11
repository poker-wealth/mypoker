import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { GameDef } from '@/lib/games';
import { haptic } from '@/lib/telegram';
import { formatMicros } from '@/api/lobby';

/**
 * One game card in the Games grid.
 *
 * SHAPE — the card is sized by ASPECT RATIO, never by a fixed pixel height.
 * It used to be `h-36` (144px) in a grid column about 114px wide, which is a
 * 0.79 portrait rectangle; the design's card is close to square and carries an
 * extra line of content, so ours read as both taller and emptier than it. A
 * ratio also guarantees the thing the design actually needs: every card in the
 * grid is identical regardless of how long its name is or whether its figures
 * have loaded, because none of that can push the height around.
 *
 * Tune TILE_RATIO alone to change the proportion — nothing else depends on it.
 *
 * LAYOUT — art panel on top taking the free space, text band anchored beneath.
 * NOT everything centred in one stack: with the art pinned at a fixed height
 * that left wide empty margins top and bottom, and Victor's reading of it was
 * "it looks too weird". An icon adrift in a big empty box reads as a broken
 * image. The art must scale with the card, not sit at 40px inside it.
 *
 * FIGURES — `tables` and `jackpot` are live values from the lobby. They were
 * previously read from a hardcoded `players` field in lib/games.ts holding the
 * design document's own numbers (2,541 / 856 / 624 …), so the screen showed
 * invented counts as live ones. There is nothing to fall back to now: when the
 * lobby has not answered, the card shows a dash rather than a number.
 */

/** width / height. 6:7 ≈ 0.857 — near-square, with room for three text rows. */
const TILE_RATIO = '6/7';

export interface GameTileProps {
  game: GameDef;
  /** Live table count for this game. Undefined until the lobby answers. */
  tables?: number;
  /** Live pooled jackpot for this game, micro-USD. */
  jackpot?: number;
  onClick?: () => void;
}

export function GameTile({ game, tables, jackpot, onClick }: GameTileProps) {
  const { t } = useTranslation();

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={() => {
        haptic('light');
        onClick?.();
      }}
      style={{ aspectRatio: TILE_RATIO }}
      className="group relative flex w-full flex-col overflow-hidden rounded-xl border border-border bg-gradient-to-b from-surface-2 to-surface text-center transition-colors hover:border-brand/50"
    >
      {/* The art takes the space the footer does not, instead of sitting at a
          fixed 40px in the middle of a ~130px card. That fixed strip was the
          whole problem: a small glyph centred in a tall box, with wide empty
          margins above and below, reads as a picture that failed to load
          rather than as a game. Same change as the native GamesScreen tile. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pt-2.5">
        {/* A soft pool of light under the art, so the piece sits ON something
            and the card reads as lit rather than as a flat panel with a sticker
            on it. Purely decorative, hence aria-hidden and no pointer events. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-2 top-1 h-full rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--brand)_18%,transparent),transparent_68%)] opacity-70"
        />
        {game.image ? (
          <img
            src={game.image}
            alt=""
            loading="lazy"
            decoding="async"
            className="relative h-full object-contain drop-shadow-[0_3px_6px_rgba(0,0,0,0.55)] transition-transform duration-200 group-active:scale-95"
          />
        ) : (
          <span className="relative text-[2.1rem] leading-none drop-shadow-md">{game.glyph}</span>
        )}
      </div>

      {/* Name and figures in one anchored band, so the text stops drifting in
          the middle of the empty space. The hairline separates it from the art
          without drawing a hard line across a small card. */}
      <div className="flex w-full shrink-0 flex-col items-center gap-0.5 border-t border-white/[0.06] bg-black/25 px-1.5 pb-2 pt-1.5">
        <div className="w-full truncate text-[0.72rem] font-bold leading-tight text-text">
          {t(`gameNames.${game.id}`, { defaultValue: game.name })}
        </div>

        {/* The table count as a chip rather than loose grey text: it is a live
            figure, and on a dark card a dim line of type reads as disabled. */}
        <div className="rounded-full bg-white/[0.06] px-1.5 py-px text-[0.58rem] leading-[1.35] text-dim">
          {tables === undefined ? '—' : t('games.tableCount', { count: tables })}
        </div>

        {/* The gold figure is this game's pooled jackpot across its tables. Shown
            only when there is one — a "$0.00" on every card is noise, and on a
            game with no pool it would be a promise of nothing. */}
        {jackpot !== undefined && jackpot > 0 && (
          <div className="text-[0.62rem] font-bold leading-none tabular-nums text-jackpot">
            ${formatMicros(jackpot, 2)}
          </div>
        )}
      </div>
    </motion.button>
  );
}
