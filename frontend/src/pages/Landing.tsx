import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Apple,
  Bot,
  Smartphone,
  Globe,
  Play,
  ChevronLeft,
  ChevronRight,
  Mail,
  Send,
  ChartNoAxesCombined,
  X,
} from 'lucide-react';

/** The reference's orbit mark — two crossed ellipses around a dot. Drawn by
 *  hand because no icon set carries this exact glyph. */
function OrbitIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <ellipse cx="16" cy="16" rx="13" ry="5.5" transform="rotate(45 16 16)" />
      <ellipse cx="16" cy="16" rx="13" ry="5.5" transform="rotate(-45 16 16)" />
      <circle cx="16" cy="16" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Three heads-and-shoulders, as on the reference's club panel. */
function GroupIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <circle cx="16" cy="11" r="4" />
      <path d="M9.5 25c0-4.4 2.9-7 6.5-7s6.5 2.6 6.5 7" />
      <circle cx="7" cy="12.5" r="2.7" />
      <path d="M2.5 23.5c0-3.4 2-5.4 4.5-5.4 .8 0 1.6.2 2.2.6" />
      <circle cx="25" cy="12.5" r="2.7" />
      <path d="M29.5 23.5c0-3.4-2-5.4-4.5-5.4-.8 0-1.6.2-2.2.6" />
    </svg>
  );
}
import { cn } from '@/lib/cn';
import { PERMANENT_DOMAIN, SUPPORT_EMAIL, SUPPORT_URL, TELEGRAM_BOT_NAME } from '@/config';

/**
 * The public landing / download page, after the reference app's — navbar,
 * permanent-domain banner, hero with the store buttons, and the welcome
 * videos. MYPOKER's brand throughout (tokens + the /brand assets), not the
 * reference's gold.
 *
 * Everything on it is honest or absent:
 *  - The permanent domain is read from the page itself; the backup-domain row
 *    renders only when `VITE_ALT_DOMAINS` (comma-separated) is configured.
 *  - iOS / Android buttons come alive when `VITE_IOS_APP_URL` /
 *    `VITE_ANDROID_APP_URL` exist; until the native builds ship they say
 *    "coming soon" instead of promising an app store nobody can reach.
 *    Telegram is derived from the configured bot name.
 *  - The four welcome-video slots play whatever is dropped at
 *    `public/videos/welcome-{1..4}.mp4`; a missing file renders as an honest
 *    placeholder, never a broken player. (The files themselves are the
 *    owner's to supply — they are not fetched from anyone else's site.)
 *  - No certification badges we do not hold.
 */

const LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '简体中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'th', label: 'ไทย' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'id', label: 'Bahasa Indonesia' },
];

const ALT_DOMAINS: string[] = (import.meta.env.VITE_ALT_DOMAINS ?? '')
  .split(',')
  .map((d: string) => d.trim())
  .filter(Boolean);

const IOS_URL: string = import.meta.env.VITE_IOS_APP_URL ?? '';
const ANDROID_URL: string = import.meta.env.VITE_ANDROID_APP_URL ?? '';
const TELEGRAM_URL = TELEGRAM_BOT_NAME ? `https://t.me/${TELEGRAM_BOT_NAME}` : '';

export function Landing() {
  const { t, i18n } = useTranslation();

  return (
    <div className="min-h-full bg-bg text-text">
      {/* ── Navbar ── */}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface/80 px-4 py-3 backdrop-blur md:px-8">
        <img src="/brand/logo-wordmark.webp" alt="MYPOKER" className="h-7 w-auto select-none" />
        <nav className="flex items-center gap-4 text-sm font-semibold">
          <Link to="/" className="text-dim transition-colors hover:text-text">
            {t('download.navHome')}
          </Link>
          <span className="text-gold">{t('download.navDownload')}</span>
          {/* The one route into the game from here. Sign-in happens when the
              visitor chooses to play — never as the first screen. */}
          <Link
            to="/login"
            className="rounded-full bg-gold px-4 py-1.5 text-[0.8rem] font-bold text-bg transition active:scale-[0.98]"
          >
            {t('download.playNow')}
          </Link>
          <label className="flex items-center gap-1 text-dim">
            <Globe size={14} aria-hidden />
            <select
              aria-label={t('download.language')}
              value={LANGS.some((l) => l.code === i18n.language) ? i18n.language : 'en'}
              onChange={(e) => void i18n.changeLanguage(e.target.value)}
              className="bg-transparent text-sm font-semibold text-text outline-none"
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code} className="bg-surface text-text">
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </nav>
      </header>

      {/* ── Permanent-domain banner, laid out like the reference: the claim
             left and large with the domain in gold, the caution right and
             quiet, the backup strip on its own darker row beneath. ── */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 bg-black/80 px-4 py-3 md:px-8">
        <div className="text-[1.05rem] md:text-lg">
          <span className="text-white">{t('download.rememberDomain')} </span>
          <a
            href={`https://www.${PERMANENT_DOMAIN}`}
            rel="noreferrer"
            className="font-bold text-gold underline-offset-2 hover:underline"
          >
            www.{PERMANENT_DOMAIN}
          </a>
        </div>
        <span className="text-[0.78rem] text-white/50">{t('download.backupBlurb')}</span>
      </div>
      {ALT_DOMAINS.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-black px-4 py-1.5 text-[0.8rem] md:px-8">
          <span className="font-bold text-white">{t('download.altDomains')}</span>
          {ALT_DOMAINS.map((d) => (
            <a key={d} href={`https://${d}`} className="text-white/85 hover:text-white" rel="noreferrer">
              https://{d}/
            </a>
          ))}
        </div>
      )}

      {/* ── Hero carousel, with the three ways in laid over it, as the
             reference does ── */}
      <div className="relative">
        <HeroCarousel />
        <div className="absolute bottom-8 left-1/2 w-full -translate-x-1/2 px-4 text-center">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <StoreButton
              href={IOS_URL}
              icon={<Apple size={18} />}
              label="iOS"
              soon={t('download.comingSoon')}
            />
            <StoreButton
              href={ANDROID_URL}
              icon={<Smartphone size={18} />}
              label="Android"
              soon={t('download.comingSoon')}
            />
            <StoreButton
              href={TELEGRAM_URL}
              icon={<Bot size={18} />}
              label={t('download.telegramApp')}
              soon={t('download.comingSoon')}
            />
          </div>
          <p className="mt-2 text-[0.7rem] text-white/70 drop-shadow">
            {t('download.telegramHint')}
          </p>
        </div>
      </div>

      {/* ── Welcome videos ── */}
      <section className="mx-auto max-w-4xl px-4 py-10 md:px-8">
        <h2 className="mb-5 text-center text-lg font-bold">{t('download.videosTitle')}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <VideoSlot key={n} index={n} />
          ))}
        </div>
      </section>

      {/* ── Feature panels, as the reference's: a wide dark scene, the phone
             mockup on the left, a thin icon top-right, the claim in large
             right-aligned type. Art slots: /brand/feature-<n>.png (the phone)
             and /brand/feature-bg-<n>.png (the scene behind it) — the panels
             stand on their copy until the art is dropped in. ── */}
      <section className="mx-auto max-w-5xl space-y-6 px-4 pb-10 md:px-8">
        <FeatureCard
          n={1}
          icon={<OrbitIcon size={40} />}
          title={t('download.feature1Title')}
          body={t('download.feature1Body')}
        />
        <FeatureCard
          n={2}
          icon={<GroupIcon size={40} />}
          title={t('download.feature2Title')}
          body={t('download.feature2Body')}
        />
        <FeatureCard
          n={3}
          icon={<ChartNoAxesCombined size={38} strokeWidth={1.25} />}
          title={t('download.feature3Title')}
          body={t('download.feature3Body')}
        />
      </section>

      {/* ── Contact ── */}
      {(SUPPORT_EMAIL || SUPPORT_URL) && (
        <section className="border-t border-border px-4 py-8 text-center">
          <h2 className="mb-4 text-lg font-bold">{t('download.contactTitle')}</h2>
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm">
            {SUPPORT_EMAIL && (
              <a href={`mailto:${SUPPORT_EMAIL}`} className="flex items-center gap-2 text-dim transition-colors hover:text-text">
                <Mail size={16} className="text-gold" aria-hidden />
                {SUPPORT_EMAIL}
              </a>
            )}
            {SUPPORT_URL && (
              <a href={SUPPORT_URL} rel="noreferrer" className="flex items-center gap-2 text-dim transition-colors hover:text-text">
                <Send size={16} className="text-gold" aria-hidden />
                {SUPPORT_URL.replace('https://t.me/', '@')}
              </a>
            )}
          </div>
        </section>
      )}

      {/* ── Footer: the big wordmark faded almost to the black, the way the
             reference ghosts its logo, with the copyright line beneath ── */}
      <footer className="relative overflow-hidden border-t border-border px-4 pb-6 pt-12 text-center">
        <img
          src="/brand/logo-wordmark.webp"
          loading="lazy"
          decoding="async"
          alt=""
          aria-hidden
          className="mx-auto mb-6 h-16 w-auto select-none opacity-[0.13] md:h-20"
        />
        <div className="text-[0.72rem] text-dim">{t('download.copyright')}</div>
      </footer>
    </div>
  );
}

/**
 * One reference-style feature panel: a wide dark scene (optional background
 * art), the phone mockup standing on the left, a thin outline icon in the
 * top-right corner, and the claim in large right-aligned type. The title is
 * for screen readers — the reference panels speak in one paragraph, and so
 * do these.
 */
function FeatureCard({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  const [hasPhone, setHasPhone] = useState(true);
  const [hasScene, setHasScene] = useState(true);
  const [fullPanel, setFullPanel] = useState(true);

  // The owner's art arrives as COMPLETE panels — scene, phone, icon and copy
  // in one image. When that file exists it IS the card; the composed version
  // below only renders while the art is missing.
  if (fullPanel) {
    return (
      <img
        src={`/brand/feature-${n}.webp`}
        alt={title}
        onError={() => setFullPanel(false)}
        loading="lazy"
        decoding="async"
        className="w-full select-none rounded-2xl"
        draggable={false}
      />
    );
  }

  return (
    <div className="relative flex min-h-[280px] items-center overflow-hidden rounded-2xl bg-surface md:min-h-[320px]">
      {hasScene && (
        <img
          src={`/brand/feature-bg-${n}.png`}
          alt=""
          aria-hidden
          onError={() => setHasScene(false)}
          className="absolute inset-0 h-full w-full select-none object-cover opacity-40"
        />
      )}
      {/* A left-to-right fade so the copy always sits on quiet ground,
          whatever the scene behind it does. */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/30 to-black/60" aria-hidden />

      {hasPhone && (
        <img
          src={`/brand/feature-${n}.webp`}
          alt=""
          aria-hidden
          onError={() => setHasPhone(false)}
          className="relative z-10 hidden h-[85%] max-h-[300px] w-auto select-none pl-4 sm:block md:pl-8"
        />
      )}

      <span className="absolute right-6 top-6 z-10 text-white/85" aria-hidden>
        {icon}
      </span>

      <div className="relative z-10 flex-1 px-5 py-10 text-right md:px-10">
        <h3 className="sr-only">{title}</h3>
        <p className="ml-auto max-w-xl text-[0.95rem] leading-relaxed text-white/90 md:text-lg">
          {body}
        </p>
      </div>
    </div>
  );
}

/**
 * The hero: a slide carousel over the owner's banner art at
 * `public/brand/hero-1.webp`, `hero-2.webp`, … (arrows + dots, auto-advance).
 * Slides that fail to load fall out of the rotation; with none present the
 * carousel is a single brand-gradient slide with the wordmark, so the page
 * never shows a broken image while the art is on its way into the repo.
 */
const HERO_SLIDES = ['/brand/hero-1.webp', '/brand/hero-2.webp'];

/**
 * How tall the banner slot is allowed to be.
 *
 * The art was previously rendered at its own natural size — `h-auto w-full` —
 * so its height was whatever the viewport width divided by the art's ratio came
 * to. hero-1 is 1024x569 (1.80), which on a 1920-wide screen is a 1067px tall
 * banner sitting below a ~110px header: the bottom edge landed roughly 300px
 * past the fold and the owner had to scroll to see the end of his own banner.
 *
 * `58svh` is the cap that fixes that — a little over half the viewport, so the
 * banner always finishes on screen with the page's next section showing beneath
 * it. `56vw` keeps it from going letterbox-thin on a phone, where the natural
 * height already fits: at 390px wide, 56vw is 218px and the art's own height is
 * 217px, so the cap is a no-op there and the picture is untouched.
 *
 * The pair of slides do not share a ratio (1.80 and 2.05), so before this the
 * carousel also changed height mid-rotation and shunted the page around. A
 * fixed slot removes that too.
 */
const HERO_HEIGHT = 'min(56vw, 58svh)';

function HeroCarousel() {
  const { t } = useTranslation();
  const [dead, setDead] = useState<Set<string>>(new Set());
  const [at, setAt] = useState(0);
  const live = HERO_SLIDES.filter((s) => !dead.has(s));
  const count = live.length;

  // Auto-advance, reference-style. Only when there is more than one slide.
  useEffect(() => {
    if (count < 2) return;
    const timer = setInterval(() => setAt((i) => (i + 1) % count), 6_000);
    return () => clearInterval(timer);
  }, [count]);

  const go = (delta: number): void => setAt((i) => (i + delta + count) % count);

  if (count === 0) {
    return (
      <section
        className="relative overflow-hidden px-4 py-14 text-center md:py-20"
        style={{ background: 'var(--brand-gradient)' }}
      >
        <div className="absolute inset-0 bg-black/45" aria-hidden />
        <div className="relative mx-auto flex max-w-xl flex-col items-center gap-4">
          <img src="/brand/logo-mark.png" alt="" aria-hidden className="h-24 w-auto select-none drop-shadow-xl" />
          <h1 className="text-3xl font-black tracking-wide text-white md:text-4xl">MYPOKER</h1>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/90">
            {t('download.tagline')}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden bg-black">
      {/* The complete banners on a sliding track — the whole row shifts one
          screen-width per slide, so a change is a glide, not a cut. Each sits
          in a capped slot (see HERO_HEIGHT) and is fitted with `object-contain`,
          so the whole banner stays on screen and nothing is cropped to fit.
          A slide that fails to load drops out of the rotation. */}
      <div className="overflow-hidden">
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${Math.min(at, count - 1) * 100}%)` }}
        >
          {live.map((s, i) => (
            <div
              key={s}
              className="relative w-full shrink-0 overflow-hidden"
              style={{ height: HERO_HEIGHT }}
            >
              {/* Whatever `contain` leaves over at the sides is filled with the
                  art's own edges, blurred — the same file, so no second
                  request, and no new art needed from the designer. */}
              <div
                aria-hidden
                className="absolute inset-0 scale-110 bg-cover bg-center blur-2xl"
                style={{ backgroundImage: `url("${s}")` }}
              />
              <img
                src={s}
                alt=""
                onError={() => setDead((d) => new Set(d).add(s))}
                className="relative h-full w-full select-none object-contain"
                draggable={false}
                decoding="async"
                fetchPriority={i === 0 ? 'high' : 'low'}
              />
            </div>
          ))}
        </div>
      </div>
      {count > 1 && (
        <>
          <button
            type="button"
            aria-label={t('download.prevSlide')}
            onClick={() => go(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/35 p-2 text-white/80"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            aria-label={t('download.nextSlide')}
            onClick={() => go(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/35 p-2 text-white/80"
          >
            <ChevronRight size={20} />
          </button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
            {live.map((s, i) => (
              <button
                key={s}
                type="button"
                aria-label={`${i + 1}/${count}`}
                onClick={() => setAt(i)}
                className={cn(
                  'size-2 rounded-full transition-colors',
                  i === at ? 'bg-gold' : 'bg-white/35',
                )}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** A store button that is a link when configured and says "soon" when not. */
function StoreButton({
  href,
  icon,
  label,
  soon,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  soon: string;
}) {
  const cls =
    'flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold transition active:scale-[0.98]';
  if (!href) {
    return (
      <span className={cn(cls, 'cursor-not-allowed bg-white/15 text-white/50')}>
        {icon}
        {label}
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[0.6rem] font-semibold">
          {soon}
        </span>
      </span>
    );
  }
  return (
    <a href={href} className={cn(cls, 'bg-white text-black shadow-lg')} rel="noreferrer">
      {icon}
      {label}
    </a>
  );
}

/**
 * The four tiles' cloth: one distinct gradient each, like the reference's
 * grey/teal/purple/maroon squares. Artwork constants, not UI tokens — the
 * same standing tableDesigns' felt palettes have.
 */
const TILE_ART = [
  'linear-gradient(140deg, #4a4a4f 0%, #232327 100%)',
  'linear-gradient(140deg, #2a7d6f 0%, #143f38 100%)',
  'linear-gradient(140deg, #8a44a8 0%, #45215a 100%)',
  'linear-gradient(140deg, #9c4046 0%, #4c1e22 100%)',
];

// Tile labels live in the locale files (download.video<n>Label) — the ghost
// lettering follows the page language, as the reference's Chinese tiles do.

/**
 * The ghost lettering, tinted to each tile's own cloth — a paler shade of
 * the gradient it sits on, as in the owner's mock, not one flat white.
 */
const TILE_TEXT = [
  'rgba(200, 200, 208, 0.38)',
  'rgba(125, 216, 200, 0.34)',
  'rgba(206, 138, 235, 0.40)',
  'rgba(235, 145, 152, 0.40)',
];

/**
 * One welcome-video tile, styled after the reference's 玩法介绍 squares: a
 * coloured gradient, the title ghosted large across it, a solid circular
 * play button. Plays `/brand/video<n>.mp4` — the four files the owner
 * supplied in public/brand/. A tile whose file goes missing degrades to the
 * gradient with a "coming soon" note, never a dead player. The download
 * link rides with the video, as asked.
 */
function VideoSlot({ index }: { index: number }) {
  const { t } = useTranslation();
  const [missing, setMissing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const src = `/brand/video${index}.mp4`;
  const label = t(`download.video${index}Label`);

  /*
   * Does the file exist? Ask, rather than open it.
   *
   * This was a hidden `<video preload="metadata">` per tile. Four of those
   * mount four media pipelines against four MP4s totalling ~28 MB on every
   * single page load, just to learn whether the files are there — and because
   * an MP4's moov atom sits at the end of the file, "metadata" can mean
   * range-requesting deep into a 14 MB clip. A HEAD request answers the same
   * question in a few hundred bytes and downloads no video at all.
   */
  useEffect(() => {
    let cancelled = false;
    const fail = (): void => {
      if (!cancelled) setMissing(true);
    };
    fetch(src, { method: 'HEAD' })
      .then((r) => {
        if (!r.ok) fail();
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [src]);
  const title = label.replace(/\n/g, ' ');

  return (
    <>
      <div
        className="relative aspect-square overflow-hidden rounded-2xl"
        style={{ background: TILE_ART[index - 1] }}
      >

        {/* The game name, ghosted big and tilted across the cloth, in the
            cloth's own paler shade. */}
        <span
          className="absolute inset-0 grid -rotate-12 select-none place-items-center whitespace-pre-line px-2 text-center text-2xl font-bold leading-tight"
          style={{
            color: TILE_TEXT[index - 1],
            // The mock's lettering: a straight grotesque, not the app's
            // rounded Nunito. Inter ships in the app's font stack already.
            fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
          }}
        >
          {label}
        </span>
        <button
          type="button"
          aria-label={title}
          disabled={missing}
          onClick={() => setPlaying(true)}
          className="absolute inset-0 grid place-items-center"
        >
          {/* The reference's ring: an outlined circle, not a filled disc. */}
          <span className="grid size-12 place-items-center rounded-full border-2 border-white/80 text-white/90 transition active:scale-95">
            <Play size={18} fill="currentColor" aria-hidden />
          </span>
        </button>
        {missing && (
          <span className="absolute inset-x-0 bottom-2 text-center text-[0.62rem] text-white/60">
            {t('download.videoMissing')}
          </span>
        )}
      </div>

      {/* The reference's player: the video floats centered over the page as
          it is — no dark wash behind it, just the clip and its shadow. Tap
          outside (or the ×) to close. */}
      {playing && !missing && (
        <div
          className="fixed inset-0 z-[90] grid place-items-center p-4"
          onClick={() => setPlaying(false)}
        >
          <video
            controls
            autoPlay
            src={src}
            className="max-h-[85vh] max-w-full rounded-lg shadow-[0_10px_60px_rgb(0_0_0/0.8)]"
            onClick={(e) => e.stopPropagation()}
            onError={() => {
              setMissing(true);
              setPlaying(false);
            }}
          />
          <button
            type="button"
            aria-label={t('common.cancel')}
            onClick={() => setPlaying(false)}
            className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/15 text-white"
          >
            <X size={20} />
          </button>
        </div>
      )}
    </>
  );
}
