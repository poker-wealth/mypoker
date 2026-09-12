/**
 * The envelope in the middle of the table.
 *
 * Two states, both in the reference: CLOSED, a flat red packet with 点我 across
 * it, and OPEN, the same packet with a pile of gold coins spilling over its top
 * edge and the amount taken floating underneath.
 *
 * Drawn rather than an image so it takes the screen's palette and stays sharp
 * at any size — and so there is no asset to ship, which matters because the
 * public bundle has a weight budget (root CLAUDE.md).
 */

import { CoinIcon } from './icons';

export function Envelope({
  open,
  amount,
  mineHit,
  canClaim,
  onClaim,
  label,
  banner,
}: {
  open: boolean;
  /** What you took, once you have. Undefined before that. */
  amount?: number;
  mineHit?: boolean;
  canClaim: boolean;
  onClaim: () => void;
  /** 点我 */
  label: string;
  /**
   * 恭喜抢到红包! — the ribbon the reference lays across the envelope in the
   * moment you grab one. Null when there is nothing to announce.
   */
  banner?: string | null;
}) {
  return (
    <div className="relative flex flex-col items-center">
      {/* The coin pile, sitting IN the envelope's mouth — drawn before the body
          so the body's flap overlaps its base, which is what makes the coins
          read as inside rather than in front. */}
      {open && (
        <div className="relative z-0 -mb-4 flex items-end justify-center">
          <CoinPile />
        </div>
      )}

      <button
        type="button"
        onClick={onClaim}
        disabled={!canClaim}
        aria-label={label}
        className={`relative z-10 block w-[10.5rem] transition ${
          canClaim ? 'cursor-pointer active:scale-[0.97]' : 'cursor-default'
        }`}
      >
        {/* The body. The reference's packet is a long portrait rectangle with a
            slightly lighter panel across the top third and a big soft seal
            watermark in the middle. */}
        <div className="relative h-[11.5rem] overflow-hidden rounded-[0.6rem] shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#f04d44_0%,#e03f3b_45%,#c62c2d_100%)]" />

          {/* The flap: a shallow curve across the top, lighter than the body. */}
          <div className="absolute inset-x-0 top-0 h-[3.2rem] overflow-hidden">
            <div className="absolute inset-x-[-10%] top-[-2.2rem] h-[5rem] rounded-[50%] bg-[linear-gradient(180deg,#f8605a_0%,#ea4a44_100%)]" />
          </div>

          {/* The seal motif, faint, exactly where the reference has it. */}
          <svg
            viewBox="0 0 100 100"
            className="absolute top-1/2 left-1/2 size-[7.5rem] -translate-x-1/2 -translate-y-1/2 opacity-[0.16]"
            aria-hidden="true"
          >
            <circle cx="50" cy="50" r="34" fill="none" stroke="#ffd9a8" strokeWidth="2.5" />
            <path
              d="M30 56c8-14 18-20 20-28 2 8 12 14 20 28-8 6-14 6-20 2-6 4-12 4-20-2z"
              fill="#ffd9a8"
            />
          </svg>

          {/* 点我, only while it is closed — once it is open the amount takes
              this spot on the reference. */}
          {!open && (
            <span className="absolute inset-x-0 bottom-[2.6rem] text-center text-[1.6rem] leading-none font-black tracking-[0.15em] text-[#ffe08a] drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)]">
              {label}
            </span>
          )}
        </div>
      </button>

      {/* 恭喜抢到红包! — a dark translucent band straight across the envelope,
          sitting over the coins and under nothing. The reference fades it in at
          the mouth of the packet, which is why it is positioned against the
          whole block rather than the body: it has to cross the coins too. */}
      {banner && (
        <div className="pointer-events-none absolute inset-x-[-18%] top-[4.2rem] z-20 bg-[linear-gradient(90deg,transparent,rgba(20,6,10,0.82)_12%,rgba(20,6,10,0.82)_88%,transparent)] py-1.5 text-center">
          <span className="text-[0.95rem] font-black tracking-wide text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.7)]">
            {banner}
          </span>
        </div>
      )}

      {/* The amount, under the envelope — white and bold in the reference, with
          the mine drawn as a loss instead. */}
      {open && amount !== undefined && (
        <span
          className={`relative z-20 -mt-6 text-[1.35rem] leading-none font-black tabular-nums drop-shadow-[0_2px_3px_rgba(0,0,0,0.6)] ${
            mineHit ? 'text-rose-200' : 'text-white'
          }`}
        >
          {mineHit ? '−' : '+'}
          {amount}
        </span>
      )}
    </div>
  );
}

/** The heap of coins the open envelope spills. Fixed offsets, not random —
    a pile that reshuffles on every render reads as flicker, not coins. */
function CoinPile() {
  const coins: Array<{ x: number; y: number; size: number }> = [
    { x: -34, y: 6, size: 26 },
    { x: -14, y: -6, size: 30 },
    { x: 6, y: -12, size: 32 },
    { x: 26, y: -4, size: 29 },
    { x: 42, y: 8, size: 25 },
    { x: -24, y: 16, size: 27 },
    { x: 0, y: 12, size: 30 },
    { x: 22, y: 16, size: 26 },
  ];
  return (
    <div className="relative h-12 w-[9rem]">
      {coins.map((c, i) => (
        <span
          key={i}
          className="absolute top-1/2 left-1/2"
          style={{ transform: `translate(calc(-50% + ${c.x}px), calc(-50% + ${c.y}px))` }}
        >
          <CoinIcon size={c.size} />
        </span>
      ))}
    </div>
  );
}
