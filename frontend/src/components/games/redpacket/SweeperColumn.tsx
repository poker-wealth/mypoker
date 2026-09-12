import type { LiveSeat } from '@/lib/liveTable';
import { CoinIcon } from './icons';

/**
 * A 扫雷玩家 column — the gold plaque and the stack of player cards under it.
 *
 * Built to the reference: an ornate gold plaque for a header, a dark red panel
 * behind the cards with a gold border, and one gold card per player carrying
 * their avatar, their name and a dark inset pill with the amount they took.
 * The running total floats OUTSIDE the panel, on the felt, facing the middle.
 */

export interface SweeperState {
  claimed?: number;
  mineHit?: boolean;
  wantsBank?: boolean;
}

export function SweeperColumn({
  title,
  players,
  stateOf,
  side,
  youLabel,
}: {
  /** 扫雷玩家 */
  title: string;
  players: LiveSeat[];
  stateOf: (index: number) => SweeperState | undefined;
  side: 'left' | 'right';
  /** 我 — the badge on your own card. */
  youLabel: string;
}) {
  return (
    <div className="flex shrink-0 flex-col items-center">
      {/* THE PLAQUE. The reference's is a gold cartouche with a darker inner
          field and flared ends; two stacked rounded rectangles and a pair of
          notches get there without an image. */}
      <div className="relative z-10 -mb-2">
        <div className="rounded-lg bg-[linear-gradient(180deg,#fff0bd_0%,#f0c760_38%,#c9902c_62%,#f5d98a_100%)] p-[2px] shadow-[0_3px_8px_rgba(0,0,0,0.45)]">
          <div className="rounded-[0.3rem] bg-[linear-gradient(180deg,#8e2418_0%,#5e150f_100%)] px-3.5 py-[3px]">
            <span className="text-[0.72rem] font-black tracking-[0.08em] whitespace-nowrap text-[#ffd97a]">
              {title}
            </span>
          </div>
        </div>
      </div>

      {/* The panel the cards sit in. */}
      <div className="w-[8.2rem] rounded-xl border-2 border-[#c9902c]/80 bg-[#3a0f14]/75 p-1.5 pt-3.5 sm:w-[9rem]">
        <div className="flex flex-col gap-1.5">
          {players.map((p) => {
            const info = stateOf(p.index);
            return (
              <div key={p.index} className="relative flex items-center gap-1">
                {/* The floating total, on the felt side of the card. */}
                {side === 'right' && <Delta info={info} side={side} />}

                <PlayerCard seat={p} info={info} youLabel={youLabel} />

                {side === 'left' && <Delta info={info} side={side} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlayerCard({
  seat,
  info,
  youLabel,
}: {
  seat: LiveSeat;
  info?: SweeperState;
  youLabel: string;
}) {
  return (
    <div
      className={`relative flex min-w-0 flex-1 items-center gap-1.5 rounded-lg p-[3px] shadow-[0_2px_5px_rgba(0,0,0,0.4)] ${
        seat.isYou
          ? 'bg-[linear-gradient(180deg,#fff0bd_0%,#f0c760_40%,#d9a13c_100%)] ring-2 ring-rose-500'
          : 'bg-[linear-gradient(180deg,#fdeab4_0%,#eec476_40%,#d9a13c_100%)]'
      }`}
    >
      {/* 我 — the reference marks your own card with a red seal at the corner. */}
      {seat.isYou && (
        <span className="absolute -top-1.5 -left-1.5 z-10 grid size-5 place-items-center rounded-full bg-[#d92b2b] text-[0.55rem] font-black text-white shadow">
          {youLabel}
        </span>
      )}

      <Avatar seat={seat} size={30} />

      <div className="min-w-0 flex-1 pr-1">
        <div className="truncate text-[0.66rem] leading-tight font-black text-[#8a3a10]">
          {seat.name}
        </div>
        {/* The dark inset pill: coin, then what they took. EMPTY until they
            tap — a zero would say they grabbed nothing, which is a different
            fact from not having grabbed. */}
        <div className="mt-[2px] flex h-[0.95rem] items-center gap-1 rounded-full bg-[#5e2a0c]/90 px-1">
          <CoinIcon size={10} />
          <span className="truncate text-[0.6rem] leading-none font-black text-[#ffd97a] tabular-nums">
            {info?.claimed ?? ''}
          </span>
        </div>
      </div>

      {/* The bomb badge on whoever took the mine. */}
      {info?.mineHit && (
        <span className="absolute -top-2 -right-2 z-10 text-[0.9rem] leading-none drop-shadow">
          <BombBadge />
        </span>
      )}
      {info?.wantsBank && !info.mineHit && (
        <span className="absolute -top-1.5 -right-1.5 z-10 rounded-full bg-sky-500 px-1 text-[0.5rem] font-black text-white shadow">
          ★
        </span>
      )}
    </div>
  );
}

function Delta({ info, side }: { info?: SweeperState; side: 'left' | 'right' }) {
  if (info?.claimed === undefined) {
    // A fixed-width spacer, so cards do not jump sideways as people claim.
    return <span className="w-[3.2rem] shrink-0" />;
  }
  return (
    <span
      className={`w-[3.2rem] shrink-0 text-[0.85rem] leading-none font-black tabular-nums drop-shadow-[0_2px_2px_rgba(0,0,0,0.6)] ${
        side === 'left' ? 'text-left' : 'text-right'
      } ${info.mineHit ? 'text-rose-300' : 'text-white'}`}
    >
      {info.mineHit ? '−' : '+'}
      {info.claimed}
    </span>
  );
}

function BombBadge() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="14" r="8" fill="#14181f" />
      <path d="M15.5 7.8l2.2-2.2" stroke="#8a5a12" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18.6 4.2l.9-2.2.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9z" fill="#ffcc4d" />
    </svg>
  );
}

export function Avatar({ seat, size }: { seat?: LiveSeat; size: number }) {
  const initial = seat?.name?.trim()?.[0]?.toUpperCase() ?? '?';
  const ring = 'rounded-full border-2 border-[#f0c760] object-cover shrink-0';
  return seat?.avatarUrl ? (
    <img
      src={seat.avatarUrl}
      alt=""
      className={ring}
      style={{ width: size, height: size }}
      loading="lazy"
      decoding="async"
    />
  ) : (
    <span
      className={`${ring} grid place-items-center bg-[#7a3a12] font-black text-[#ffd97a]`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initial}
    </span>
  );
}
