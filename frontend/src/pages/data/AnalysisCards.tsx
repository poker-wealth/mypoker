import { useTranslation } from 'react-i18next';
import { Info, MapPin, Layers, ShieldCheck } from 'lucide-react';

/**
 * The analysis half of the Data page — the reference's lower cards.
 *
 * Player Stats Radar, Key Stats, Position, Hand Types and the fairness bar,
 * laid out exactly as the reference has them and in OUR palette: gold, not the
 * reference's green. Owner, 12 Sep 2026: "dont change it to green still gold
 * but exactly what is there."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY MOST OF THESE ARE EMPTY, and why they are on screen anyway.
 *
 * Every figure in this half — VPIP, PFR, 3-Bet, 4-Bet, WTSD, W$SD, Aggression,
 * BB/100, All-in EV, and the whole Position and Hand Types breakdown — is
 * derived from what happened INSIDE a hand: what you were dealt, whether you
 * put money in before the flop, whether you raised, how far you went. The
 * server records none of that. The ledger stores a round's NET MOVEMENT and its
 * timestamp, which is enough for profit, hands played and win rate, and not
 * enough for anything here.
 *
 * The reference fills these with 24.6%, 19.3%, 8.2%, 1.8 and so on. Those are
 * design-document numbers. Printing them would not be a placeholder — it would
 * be a claim about how this player plays, sitting beside figures that are real,
 * which makes the real ones unbelievable too.
 *
 * So the cards are drawn, in their right places, at their right sizes, saying
 * plainly what they are waiting for. When hand recording lands they fill in
 * without the page moving. That is the honest version of "exactly this UI".
 */

/** The one sentence every unfilled card says, so it reads as one cause. */
function Pending({ label }: { label: string }) {
  return (
    <div className="flex min-h-[3rem] items-center justify-center px-3 py-4 text-center">
      <span className="text-[0.66rem] leading-snug text-dim">{label}</span>
    </div>
  );
}

function CardShell({
  title,
  icon,
  hint,
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-(--radius-app) border border-border bg-surface p-3 ${className ?? ''}`}
    >
      <div className="mb-2 flex items-center gap-1.5">
        {icon}
        <h3 className="text-[0.72rem] font-bold">{title}</h3>
        {hint && <Info size={11} className="text-dim" aria-label={hint} />}
      </div>
      {children}
    </section>
  );
}

/**
 * The six-spoke radar.
 *
 * Drawn as a real hexagon with its rings and spokes — the shape is the card,
 * and an empty card that is just a sentence would not read as the same screen.
 * The DATA polygon is what is missing, so the axes are labelled and the middle
 * says why nothing is plotted on them.
 */
export function StatsRadar() {
  const { t } = useTranslation();
  const axes = [
    t('data.vpip'),
    t('data.pfr'),
    t('data.threeBet'),
    t('data.wtsd'),
    t('data.wssd'),
    t('data.aggression'),
  ];

  // Six points of a hexagon, starting at the top and running clockwise.
  const point = (i: number, r: number): [number, number] => {
    const angle = -Math.PI / 2 + (i * Math.PI) / 3;
    return [50 + r * Math.cos(angle), 50 + r * Math.sin(angle)];
  };
  const ring = (r: number): string =>
    Array.from({ length: 6 }, (_, i) => point(i, r).join(',')).join(' ');

  return (
    <CardShell title={t('data.radarTitle')} hint={t('data.radarHint')}>
      <div className="relative">
        <svg viewBox="0 0 100 100" className="w-full" role="img" aria-label={t('data.radarTitle')}>
          {[38, 28, 19, 9].map((r) => (
            <polygon
              key={r}
              points={ring(r)}
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
              className="text-border"
            />
          ))}
          {Array.from({ length: 6 }, (_, i) => {
            const [x, y] = point(i, 38);
            return (
              <line
                key={i}
                x1="50"
                y1="50"
                x2={x}
                y2={y}
                stroke="currentColor"
                strokeWidth="0.4"
                className="text-border"
              />
            );
          })}
        </svg>

        {/* Axis labels, placed around the hexagon the way the reference has
            them — above the top spoke, outside each corner. */}
        {axes.map((label, i) => {
          const [x, y] = point(i, 47);
          return (
            <span
              key={label}
              className="absolute -translate-x-1/2 -translate-y-1/2 text-[0.58rem] font-semibold whitespace-nowrap text-dim"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              {label}
            </span>
          );
        })}

        <div className="absolute inset-0 grid place-items-center">
          <span className="max-w-[7.5rem] text-center text-[0.6rem] leading-snug text-dim">
            {t('data.needsHands')}
          </span>
        </div>
      </div>
    </CardShell>
  );
}

/** The six figures the reference puts beside the radar. */
export function KeyStats() {
  const { t } = useTranslation();
  const rows = [
    t('data.bb100'),
    t('data.allInEv'),
    t('data.wtsd'),
    t('data.wssd'),
    t('data.threeBet'),
    t('data.fourBet'),
  ];
  return (
    <CardShell title={t('data.keyStats')}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {rows.map((label) => (
          <div key={label} className="flex items-baseline justify-between gap-2">
            <span className="text-[0.66rem] text-dim">{label}</span>
            {/* An em dash, not a zero. "0.0" is a measurement; this is the
                absence of one. */}
            <span className="text-[0.72rem] font-bold text-dim tabular-nums">—</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[0.6rem] leading-snug text-dim">{t('data.needsHands')}</p>
    </CardShell>
  );
}

/** Profit by position — BTN through BB. */
export function PositionCard() {
  const { t } = useTranslation();
  const seats = ['BTN', 'CO', 'MP', 'UTG', 'SB', 'BB'];
  return (
    <CardShell title={t('data.position')} icon={<MapPin size={12} className="text-brand" />}>
      <div className="space-y-1">
        {seats.map((seat) => (
          <div key={seat} className="flex items-baseline justify-between">
            <span className="text-[0.66rem] text-dim">{seat}</span>
            <span className="text-[0.7rem] font-bold text-dim tabular-nums">—</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[0.6rem] leading-snug text-dim">{t('data.needsHands')}</p>
    </CardShell>
  );
}

/** Profit by starting hand class. */
export function HandTypesCard() {
  const { t } = useTranslation();
  const kinds = [
    t('data.suited'),
    t('data.broadway'),
    t('data.pocketPairs'),
    t('data.offsuit'),
    t('data.trash'),
  ];
  return (
    <CardShell title={t('data.handTypes')} icon={<Layers size={12} className="text-brand" />}>
      <div className="space-y-1">
        {kinds.map((kind) => (
          <div key={kind} className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[0.66rem] text-dim">{kind}</span>
            <span className="shrink-0 text-[0.7rem] font-bold text-dim tabular-nums">—</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[0.6rem] leading-snug text-dim">{t('data.needsHands')}</p>
    </CardShell>
  );
}

/**
 * The fairness bar across the foot of the reference.
 *
 * THIS ONE IS REAL, which is why it says a different kind of sentence. Every
 * round IS committed and verifiable — the seed, the round hash and the Merkle
 * proof are the fairness rail this project already runs (`src/lib/fairness`,
 * and the verifier behind the table's Fairness panel). What is NOT claimed here
 * is a hand count, because that would need the same recording everything above
 * is waiting for.
 */
export function FairnessBar({ onVerify }: { onVerify?: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="flex items-center gap-3 rounded-(--radius-app) border border-brand/30 bg-surface p-3">
      <ShieldCheck size={18} className="shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <div className="text-[0.72rem] font-bold">{t('data.fairnessTitle')}</div>
        <div className="text-[0.62rem] leading-snug text-dim">{t('data.fairnessBlurb')}</div>
      </div>
      {onVerify && (
        <button
          type="button"
          onClick={onVerify}
          className="shrink-0 rounded-full border border-brand/50 px-3 py-1.5 text-[0.66rem] font-bold text-brand transition active:scale-95"
        >
          {t('data.verifyHands')}
        </button>
      )}
    </section>
  );
}

export { Pending };
