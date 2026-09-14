/**
 * The three icons the 红包扫雷 header carries: the coin, the packet, the mine.
 *
 * DRAWN, not emoji. The felt used 🪙 🧧 💣 and they were wrong in three ways at
 * once: every platform draws them differently (an Android coin is silver, an
 * iOS bomb is round, a Windows packet is a plain envelope), they cannot take
 * the gold palette the rest of the screen is built from, and they sit on the
 * text baseline instead of centring in a pill. The reference's are small pieces
 * of artwork; these are the same pieces of artwork in SVG, so they are identical
 * on every device and scale with the pill rather than the font.
 */

export function CoinIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <defs>
        <radialGradient id="rp-coin" cx="38%" cy="32%" r="72%">
          <stop offset="0%" stopColor="#ffe9a8" />
          <stop offset="55%" stopColor="#f2c14b" />
          <stop offset="100%" stopColor="#b8801c" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="11" fill="url(#rp-coin)" stroke="#8a5a12" strokeWidth="1" />
      <circle cx="12" cy="12" r="7.6" fill="none" stroke="#8a5a12" strokeWidth="0.9" opacity="0.55" />
      {/* The square hole of a cash coin, which is what makes it read as one at 14px. */}
      <rect x="9.6" y="9.6" width="4.8" height="4.8" rx="0.8" fill="#8a5a12" opacity="0.75" />
      <path d="M6 6.5a9 9 0 0 1 5-3" stroke="#fff8dd" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" fill="none" />
    </svg>
  );
}

export function PacketIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id="rp-packet" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4b45" />
          <stop offset="100%" stopColor="#b81f24" />
        </linearGradient>
      </defs>
      <rect x="5" y="2.5" width="14" height="19" rx="2" fill="url(#rp-packet)" />
      {/* The flap and the gold seal — the two things that say "red packet". */}
      <path d="M5 4.5v4c2.6 2 4.9 3 7 3s4.4-1 7-3v-4z" fill="#ffd479" opacity="0.28" />
      <circle cx="12" cy="12.4" r="2.9" fill="#ffd479" />
      <circle cx="12" cy="12.4" r="1.5" fill="#b81f24" opacity="0.55" />
    </svg>
  );
}

export function MineIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <defs>
        <radialGradient id="rp-mine" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#6b7280" />
          <stop offset="60%" stopColor="#1f2937" />
          <stop offset="100%" stopColor="#0b0f14" />
        </radialGradient>
      </defs>
      <circle cx="11" cy="14" r="8" fill="url(#rp-mine)" />
      <path d="M15.5 7.8l2.2-2.2" stroke="#8a5a12" strokeWidth="1.6" strokeLinecap="round" />
      {/* The spark. Without it a bomb at this size is just a dark circle. */}
      <path
        d="M18.6 4.2l.9-2.2.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9z"
        fill="#ffcc4d"
      />
      <circle cx="8.4" cy="11.4" r="2" fill="#fff" opacity="0.18" />
    </svg>
  );
}
