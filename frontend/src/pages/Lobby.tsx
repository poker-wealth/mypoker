import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useNavigate } from 'react-router-dom';
import { SlidersHorizontal, ChevronRight, ChevronLeft, LayoutGrid, Dice5 } from 'lucide-react';
import { useTables } from '@/api/hooks';
import { formatMicros } from '@/api/lobby';

import { ContextBanner } from '@/components/ContextBanner';
import { Skeleton } from '@/components/ui/Skeleton';
import { GAMES } from '@/lib/games';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';

/**
 * The promo banners, mirroring `PROMO_SLIDES` in
 * `mobile/src/screens/LobbyScreen.tsx` — one lobby, two clients.
 *
 * WebP, not the PNGs the app ships: these are 626 KB here against 5.7 MB of
 * source art, and the web side has a weight budget the native app does not
 * (root CLAUDE.md). Each banner is FINISHED artwork — the wordmark, the
 * headline and the "View details by clicking" pill are painted in — so
 * nothing is drawn on top of them.
 */
const PROMO_SLIDES = ['/brand/promo-1.webp', '/brand/promo-2.webp', '/brand/promo-3.webp', '/brand/promo-4.webp'];

/** How long a banner holds before the next slides in. Matches the app. */
const PROMO_INTERVAL_MS = 5_000;

/**
 * A lobby row, built only from what the server actually sent.
 *
 * There is deliberately no sample/fallback list any more. Six invented tables
 * (T-001…T-006, with "$1,200" and "$980" in the status column) used to render
 * whenever the API returned nothing — which, with the gateway undeployed, is
 * every time. A player opening the app saw a full lobby of tables that do not
 * exist, priced with figures nobody computed. An empty lobby is a fact; a
 * fabricated one is a lie that also happens to be unjoinable.
 */
interface DisplayTable {
  id: string;
  blinds: string;
  players: string;
  buyIn: string;
  /** Pooled jackpot on this table, micro-USD. Null when the table has none. */
  jackpot: number | null;
  isFull: boolean;
  /** The table this player is seated at — the one that is refusing all the others. */
  youAreSeated: boolean;
  /** Table chips. Null when the game has no stake level — see formatBlinds. */
  stakes: number | null;
}

const VARIANTS = [
  { id: 'dezhou', label: 'DEZHOU' },
  { id: 'ausha', label: 'AUSHA' },
  { id: 'others', label: 'OTHERS' },
];

/**
 * The blind filters, in TABLE CHIPS — the unit the server filters in.
 *
 * These were micro-USD (2_000_000 for "1/2") against a server comparing table
 * chips, whose largest big blind is 100. Every threshold was therefore
 * unreachable and tapping ANY filter but ALL emptied the lobby completely.
 * Same root cause as the blinds column: the numbers were correct for
 * `dev-seed.ts` and nobody re-read them when the live rooms took over.
 *
 * `minStakes` is the big blind, so the label's second number is the value.
 */
const STAKES_OPTIONS = [
  { id: 'all', label: 'ALL', minStakes: undefined },
  { id: '1/2', label: '1/2', minStakes: 2 },
  { id: '5/10', label: '5/10', minStakes: 10 },
  { id: '25/50', label: '25/50', minStakes: 50 },
  { id: '100/200', label: '100/200', minStakes: 200 },
];

/**
 * The blinds cell.
 *
 * Chips are not money: no currency mark, no micro conversion, just a grouped
 * integer. An em dash when the table has no blind structure at all — nine of
 * the thirteen live tables let each player pick their own bet, and printing
 * "0/0" for them stated a stake level that does not exist (docs/TRAPS.md #3).
 *
 * NO `stakes / 2` FALLBACK. An earlier draft of this used one for tables whose
 * server had not sent a small blind, and it promptly invented one: Dou Di Zhu
 * has a flat base stake of 100 and no blinds at all, and the fallback printed
 * it as "50/100". A missing small blind means there is no pair to show, not
 * that it can be guessed — so a flat stake renders as the single figure it is.
 */
function formatBlinds(stakes: number | null, smallBlind?: number | null): string {
  if (stakes === null || stakes === undefined) return '—';
  if (smallBlind === null || smallBlind === undefined) return stakes.toLocaleString();
  return `${smallBlind.toLocaleString()}/${stakes.toLocaleString()}`;
}

export function Lobby() {
  const navigate = useNavigate();
  const [variant, setVariant] = useState('dezhou');
  const [blinds, setBlinds] = useState('all');
  const [onlyOpen, setOnlyOpen] = useState(false);
  /** 'home' is the lobby; 'tables' is the Live Tables screen JOIN opens. */
  const [view, setView] = useState<'home' | 'tables'>('home');
  const { t } = useTranslation();

  const targetStakes = STAKES_OPTIONS.find((s) => s.id === blinds)?.minStakes;

  // DEZHOU and AUSHA are single games and filter server-side. OTHERS means
  // "every table that is not one of those tabs" — a set the server has no
  // filter parameter for, and sending `gameId: 'others'` is a 400: the filter
  // parser rejects unknown game ids by design. (It always did; the sample-table
  // fallback used to swallow the error and show fake tables instead, which is
  // how a permanently broken tab went unnoticed.) So OTHERS fetches unfiltered
  // and excludes the named tabs' games client-side.
  const TAB_GAME: Record<string, string | undefined> = { dezhou: 'texas', ausha: 'omaha' };
  const tables = useTables({
    ...(TAB_GAME[variant] ? { gameId: TAB_GAME[variant] } : {}),
    minStakes: targetStakes,
    maxStakes: targetStakes,
    // Stakes and seat filters stay server-side, so the count the lobby shows
    // is the count the server filtered.
    ...(onlyOpen ? { hasSeats: true } : {}),
  });

  const rawTables =
    variant === 'others'
      ? (tables.data?.tables ?? []).filter((tb) => !Object.values(TAB_GAME).includes(tb.gameId))
      : (tables.data?.tables ?? []);

  // Null while the lobby has not answered. '$ 0.00' is a claim about the pools
  // and it is the wrong one — the hero shows a skeleton instead.

  const displayTables: DisplayTable[] = rawTables.map((t) => ({
    id: t.id,
    blinds: formatBlinds(t.stakes, t.smallBlind),
    players: `${t.players} / ${t.maxPlayers}`,
    // The server's own figure. It used to fall back to 40 when absent, which
    // put a buy-in on the row that the table had never quoted.
    buyIn: t.buyInBB === null ? '—' : `${t.buyInBB} BB`,
    // Null rather than a substitute. The old line read
    //   t.jackpot || t.stakes * 10
    // so a table with an empty pool advertised ten times its blind as a dollar
    // amount — invented from unrelated data, on REAL tables, not just the
    // sample ones. Nothing here may stand in for a number the server did not
    // send.
    jackpot: t.jackpot > 0 ? t.jackpot : null,
    isFull: t.status === 'FULL' || t.players >= t.maxPlayers,
    youAreSeated: t.youAreSeated === true,
    stakes: t.stakes,
  }));

  // ── Promo carousel ────────────────────────────────────────────────────────
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  /**
   * Advance on its own, pausing while a pointer rests on the banner.
   *
   * Scheduled from the slide actually showing, so a manual tap on a dot
   * restarts the clock rather than firing on the old one's leftover timer.
   */
  useEffect(() => {
    if (paused || PROMO_SLIDES.length < 2) return;
    const id = setTimeout(() => setSlide((s) => (s + 1) % PROMO_SLIDES.length), PROMO_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [slide, paused]);

  /**
   * The tables list, as its own screen — the shape the native app uses.
   *
   * Everything below (the DEZHOU/AUSHA/OTHERS tabs, the blind filters, the
   * table itself) used to sit stacked under the banner on one long page,
   * which is not what the app does and not what the owner approved: there,
   * JOIN opens "Live Tables" and the lobby home stays a lobby.
   */
  /**
   * Tabs, blind filters and the table itself — the whole Live Tables
   * screen, held in one place so the `tables` view above renders exactly
   * what the lobby used to render inline.
   */
  const tablesSection = (
    <>
        {/* Game Type Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {VARIANTS.map((v) => {
            const active = variant === v.id;
            return (
              <button
                key={v.id}
                onClick={() => setVariant(v.id)}
                className={cn(
                  'px-3.5 py-2 text-xs font-black tracking-wider transition-all rounded-lg shrink-0',
                  active
                    ? 'border border-gold bg-[color-mix(in_srgb,var(--gold)_16%,transparent)] text-gold shadow-[0_0_12px_color-mix(in_srgb,var(--gold)_28%,transparent)]'
                    : 'bg-surface-2/60 text-dim border border-transparent hover:text-text',
                )}
              >
                {v.label}
              </button>
            );
          })}
        </div>

        {/* Stakes Filter Pills */}
        <div className="flex items-center justify-between gap-1.5 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5">
            {STAKES_OPTIONS.map((s) => {
              const active = blinds === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setBlinds(s.id)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-bold transition-all rounded-md shrink-0',
                    active
                      ? 'bg-gold text-bg shadow-xs'
                      : 'bg-surface-2/80 text-dim hover:text-text',
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          {/* Was inert. Toggles the one filter a player in a lobby actually
              wants — hide tables they cannot sit at — which the API already
              supports via hasSeats. */}
          <button
            aria-label={t('lobby.onlyOpen')}
            aria-pressed={onlyOpen}
            onClick={() => {
              haptic('light');
              setOnlyOpen((v) => !v);
            }}
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-md border transition-colors active:scale-95',
              onlyOpen
                ? 'border-gold bg-[color-mix(in_srgb,var(--gold)_16%,transparent)] text-gold'
                : 'border-border bg-surface-2 text-dim hover:text-text',
            )}
          >
            <SlidersHorizontal size={14} />
          </button>
        </div>

        {/* Table List Grid */}
        <div className="overflow-hidden rounded-xl border border-border/80 bg-surface/90 shadow-sm">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 text-[0.65rem] text-dim uppercase tracking-wider">
                <th className="px-3 py-2.5 font-bold">Table</th>
                <th className="px-3 py-2.5 font-bold">Blinds</th>
                <th className="px-3 py-2.5 font-bold">Players</th>
                <th className="px-3 py-2.5 font-bold">Buy-in</th>
                <th className="px-3 py-2.5 text-right font-bold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {tables.isPending ? (
                [0, 1, 2].map((i) => (
                  <tr key={i}>
                    <td colSpan={5} className="px-3 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))
              ) : tables.isError ? (
                // An unreachable lobby is not an empty one. Saying "no tables
                // found" when the request failed tells the player the platform
                // is dead rather than that we could not ask.
                <tr>
                  <td colSpan={5} className="py-8 text-center text-dim">
                    {t('states.serviceUnavailable')}
                  </td>
                </tr>
              ) : displayTables.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-dim">
                    {t('lobby.noTables')}
                  </td>
                </tr>
              ) : (
                displayTables.map((tbl) => (
                  <tr
                    key={tbl.id}
                    onClick={() => navigate(`/table/${tbl.id}`)}
                    className="cursor-pointer transition-colors active:bg-surface-2/80 hover:bg-surface-2/40"
                  >
                    {/* The table's real id. It used to render `T-00${index}`, a
                        label invented per render that matched nothing a player
                        could be told over support. */}
                    <td className="px-3 py-3 font-bold text-[#eab308]">
                      {tbl.id}
                      {/* The row holding this player's seat. It is the reason every
                          other table is refusing them, and the only row that can
                          release it — so it is marked next to the name rather than
                          buried in the status column. */}
                      {tbl.youAreSeated && (
                        <span className="ml-2 rounded-full bg-brand/20 px-2 py-0.5 text-[0.6rem] font-bold text-brand align-middle">
                          {t('lobby.yourSeat')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-dim font-medium">{tbl.blinds}</td>
                    <td className="px-3 py-3 tabular-nums font-semibold text-text">{tbl.players}</td>
                    <td className="px-3 py-3 tabular-nums text-dim font-medium">{tbl.buyIn}</td>
                    <td className="px-3 py-3 text-right">
                      {tbl.isFull ? (
                        <span className="inline-block min-w-16 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-center text-[0.7rem] font-bold text-dim">
                          {t('lobby.wait')}
                        </span>
                      ) : tbl.jackpot !== null ? (
                        <span className="inline-block min-w-16 rounded-md border border-jackpot/40 bg-[color-mix(in_srgb,var(--jackpot)_14%,transparent)] px-2.5 py-1 text-center text-[0.7rem] font-bold text-jackpot shadow-xs">
                          ${formatMicros(tbl.jackpot, 0)}
                        </span>
                      ) : (
                        // Open, but with no pool to advertise. Say the table is
                        // open rather than print a dollar sign next to nothing.
                        <span className="inline-block min-w-16 rounded-md border border-jackpot/40 bg-[color-mix(in_srgb,var(--jackpot)_14%,transparent)] px-2.5 py-1 text-center text-[0.7rem] font-bold text-jackpot shadow-xs">
                          {t('lobby.open')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

    </>
  );

  if (view === 'tables') {
    return (
      <div className="flex flex-col space-y-3.5 pb-4">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setView('home')}
            aria-label={t('common.back')}
            className="grid size-9 place-items-center rounded-lg text-dim transition-colors hover:bg-surface-2 hover:text-text"
          >
            <ChevronLeft size={20} />
          </button>
          {/* Padded by the button's width so the title centres on the screen. */}
          <h2 className="min-w-0 flex-1 truncate pr-9 text-center text-base font-black">
            {t('lobby.liveTables')}
          </h2>
        </div>
        {tablesSection}
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-3.5 pb-4">
      <ContextBanner />

      {/* Promo banners — the app's lobby, on the web. The slide is the image
          and nothing else: the art already carries its own headline and CTA,
          so any text here would print the words twice. */}
      <div
        className="relative overflow-hidden rounded-2xl"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        onTouchEnd={() => setPaused(false)}
      >
        <div
          ref={trackRef}
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${slide * 100}%)` }}
        >
          {PROMO_SLIDES.map((src, i) => (
            <img
              key={src}
              src={src}
              alt=""
              aria-hidden
              draggable={false}
              // The first banner is the one on screen at first paint; the rest
              // can wait until the carousel reaches them.
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              className="w-full shrink-0 select-none rounded-2xl"
            />
          ))}
        </div>
        {PROMO_SLIDES.length > 1 && (
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {PROMO_SLIDES.map((src, i) => (
              <button
                key={src}
                type="button"
                aria-label={`${i + 1} / ${PROMO_SLIDES.length}`}
                onClick={() => setSlide(i)}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === slide ? 'w-3.5 bg-white' : 'w-1.5 bg-white/40',
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* CREATE / JOIN — beneath the banner, never over it: the artwork
          carries its own call to action and a bar across it hides that. */}
      <div className="flex overflow-hidden rounded-2xl bg-gold text-bg shadow-lg">
        <button
          type="button"
          onClick={() => {
            haptic('light');
            navigate('/games');
          }}
          className="flex flex-1 items-center justify-center gap-2 border-r border-black/20 py-3 text-sm font-black tracking-wide transition active:scale-[0.99]"
        >
          <LayoutGrid size={18} />
          {t('lobby.create')}
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          onClick={() => {
            haptic('light');
            setView('tables');
          }}
          className="flex flex-1 items-center justify-center gap-2 py-3 text-sm font-black tracking-wide transition active:scale-[0.99]"
        >
          <Dice5 size={18} />
          {t('lobby.join')}
          <ChevronRight size={14} />
        </button>
      </div>

      {/* My Games — OUR catalogue, translated, with the fire mark only on the
          games the catalogue actually flags hot. */}
      <div>
        <div className="mb-2 text-base font-black">{t('lobby.myGames')}</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => setVariant('dezhou')}
            className="rounded-full bg-gold px-3 py-1 text-xs font-black text-bg"
          >
            {t('games.filterAll')}
          </button>
          {GAMES.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => navigate(`/table/${g.id}`)}
              className="text-[0.8rem] font-semibold text-dim transition-colors hover:text-text"
            >
              {g.hot ? '🔥' : ''}
              {t(`gameNames.${g.id}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Tournament — the section the app carries, with the truth in it.
          There is NO tournament backend: no route, no engine, nothing on the
          server answers for an MTT. The app's version of this lists invented
          events ("Golden Freeroll-8 Max", a 500 prize, a date in September)
          that no player can enter and no code produced. Copying those here
          would have doubled a fabrication rather than shipped a feature, so
          the section says what is true and will fill itself the day a
          schedule exists. */}
      <div>
        <div className="mb-2 text-base font-black">{t('lobby.tournaments')}</div>
        <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-6 text-center text-[0.8rem] text-dim">
          {t('lobby.noTournaments')}
        </div>
      </div>

      {/* No QUICK JOIN / CREATE PRIVATE TABLE pair here. CREATE and JOIN live
          on the lobby's home view; repeating them at the foot of the table
          list gave the same two doors different names on one screen. Removed
          from the app for that reason — the clients match. */}
    </div>
  );
}


