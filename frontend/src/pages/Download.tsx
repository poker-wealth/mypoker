import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Apple,
  Bot,
  Smartphone,
  Download as DownloadIcon,
  Globe,
  Play,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { TELEGRAM_BOT_NAME } from '@/config';

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

export function Download() {
  const { t, i18n } = useTranslation();

  return (
    <div className="min-h-full bg-bg text-text">
      {/* ── Navbar ── */}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface/80 px-4 py-3 backdrop-blur md:px-8">
        <img src="/brand/logo-wordmark.png" alt="MYPOKER" className="h-7 w-auto select-none" />
        <nav className="flex items-center gap-4 text-sm font-semibold">
          <Link to="/" className="text-dim transition-colors hover:text-text">
            {t('download.navHome')}
          </Link>
          <span className="text-gold">{t('download.navDownload')}</span>
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

      {/* ── Permanent-domain banner ── */}
      <div className="border-b border-border bg-surface px-4 py-2.5 text-center text-[0.8rem] md:px-8">
        <span className="text-dim">{t('download.rememberDomain')} </span>
        <span className="font-bold text-gold">{window.location.host}</span>
        <span className="ml-2 hidden text-[0.72rem] text-dim md:inline">
          {t('download.backupBlurb')}
        </span>
      </div>
      {ALT_DOMAINS.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 border-b border-border bg-surface-2/60 px-4 py-1.5 text-[0.72rem]">
          <span className="text-dim">{t('download.altDomains')}</span>
          {ALT_DOMAINS.map((d) => (
            <a
              key={d}
              href={`https://${d}`}
              className="rounded bg-surface px-2 py-0.5 text-accent"
              rel="noreferrer"
            >
              {d}
            </a>
          ))}
        </div>
      )}

      {/* ── Hero carousel ── */}
      <HeroCarousel />

      {/* ── The three ways in ── */}
      <section className="px-4 py-8 text-center">
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
        <p className="mt-3 text-[0.7rem] text-dim">{t('download.telegramHint')}</p>
      </section>

      {/* ── Welcome videos ── */}
      <section className="mx-auto max-w-4xl px-4 py-10 md:px-8">
        <h2 className="mb-1 text-center text-lg font-bold">{t('download.videosTitle')}</h2>
        <p className="mb-5 text-center text-[0.78rem] text-dim">{t('download.videosBlurb')}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((n) => (
            <VideoSlot key={n} index={n} />
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border px-4 py-6 text-center text-[0.72rem] text-dim">
        MYPOKER · {window.location.host}
      </footer>
    </div>
  );
}

/**
 * The hero: a slide carousel over the owner's banner art at
 * `public/brand/hero-1.png`, `hero-2.png`, … (arrows + dots, auto-advance).
 * Slides that fail to load fall out of the rotation; with none present the
 * carousel is a single brand-gradient slide with the wordmark, so the page
 * never shows a broken image while the art is on its way into the repo.
 */
const HERO_SLIDES = ['/brand/hero-1.png', '/brand/hero-2.png'];

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
      {/* Probe every slide so a missing file drops out instead of flashing broken. */}
      {HERO_SLIDES.map((s) => (
        <img
          key={`probe-${s}`}
          src={s}
          alt=""
          aria-hidden
          className="hidden"
          onError={() => setDead((d) => new Set(d).add(s))}
        />
      ))}
      <img
        src={live[Math.min(at, count - 1)]}
        alt=""
        className="mx-auto max-h-[60vh] w-full select-none object-cover"
        draggable={false}
      />
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
 * One welcome-video slot. Plays `/videos/welcome-<n>.mp4` when the file has
 * been dropped into `public/videos/`; a missing file becomes a labelled
 * placeholder instead of a dead player. The download link rides with the
 * video, as asked — same file, saved instead of streamed.
 */
function VideoSlot({ index }: { index: number }) {
  const { t } = useTranslation();
  const [missing, setMissing] = useState(false);
  const src = `/videos/welcome-${index}.mp4`;

  if (missing) {
    return (
      <div className="grid aspect-video place-items-center rounded-(--radius-app) border border-dashed border-border bg-surface text-center">
        <div className="text-dim">
          <Play size={22} className="mx-auto mb-1.5 opacity-60" aria-hidden />
          <div className="text-[0.75rem] font-semibold">
            {t('download.videoTitle', { n: index })}
          </div>
          <div className="text-[0.65rem]">{t('download.videoMissing')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-(--radius-app) border border-border bg-surface">
      <video
        controls
        preload="metadata"
        src={src}
        className="aspect-video w-full bg-black"
        onError={() => setMissing(true)}
      />
      <div className="flex items-center justify-between px-3 py-2 text-[0.75rem]">
        <span className="font-semibold">{t('download.videoTitle', { n: index })}</span>
        <a href={src} download className="flex items-center gap-1 font-semibold text-accent">
          <DownloadIcon size={13} aria-hidden />
          {t('download.videoDownload')}
        </a>
      </div>
    </div>
  );
}
