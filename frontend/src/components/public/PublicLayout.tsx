import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MIRROR_DOMAINS, SITE_DOMAIN, SUPPORT_URL } from '@/config';
import { PLATFORMS, PLATFORM_ICON, platformTargets } from './platform';
import './publicSite.css';

/**
 * The chrome shared by every public page — a port of the reference site's Layout.
 *
 * Theirs is a Vue layout with three slots, and both routes render inside it:
 *
 *   header    → SiteHeader (logo, nav) + DomainName
 *   contenter → Carouselitem (the hero, with the download buttons over it)
 *               followed by <router-view> — the page itself
 *   footer    → CopeRight
 *
 * So the hero belongs to the LAYOUT, not to either page: it is the same two
 * slides above the home page and above the download page. `children` lands
 * where their `<router-view>` does.
 *
 * PUBLIC: no session, no AppShell, no bottom nav. Whoever lands here has not
 * signed up and may never have heard of us.
 *
 * Sizing and colour live in `publicSite.css`, which explains the unit system:
 * the reference scales every length off the viewport width, and that file keeps
 * its numbers so the two can be compared rule by rule.
 */

/** The hero art. Real brand work — not the borrowed placeholders. */
const HERO = ['/download/hero-1.png', '/download/hero-2.png'];

/** Their swiper: `autoplay: { delay: 4e3 }`. */
const AUTOPLAY_MS = 4000;
/** How long autoplay stays parked after someone scrolls the hero themselves. */
const RESUME_MS = 9000;

/**
 * The hero.
 *
 * Theirs is Swiper — a track, bullets, white arrows, and the download buttons
 * absolutely positioned over the bottom of it. Rebuilt on scroll-snap rather
 * than pulling in the library: swiping, momentum and the rubber-band at either
 * end become the browser's, and autoplay is a `scrollTo`, so a timer and a
 * thumb-drag are the same operation and cannot fight each other.
 *
 * It stops when touched (for `RESUME_MS`), when hovered, when focus is inside
 * it, when the tab is hidden, and entirely under `prefers-reduced-motion`.
 */
function Hero({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const holdUntil = useRef(0);

  /* Watched, not sampled once: on a phone this setting gets flipped
     mid-session, often by the person it affects, mid-symptom. */
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => setReduced(q.matches);
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);

  const go = useCallback(
    (i: number): void => {
      const track = trackRef.current;
      if (!track) return;
      const wrapped = (i + HERO.length) % HERO.length;
      track.scrollTo({
        left: track.clientWidth * wrapped,
        behavior: reduced ? 'auto' : 'smooth',
      });
    },
    [reduced],
  );

  /* The track is the source of truth for which slide is showing — a swipe
     changes it without going through React, so state follows the DOM. */
  const onScroll = useCallback((): void => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    holdUntil.current = Date.now() + RESUME_MS;
    setIndex(Math.round(track.scrollLeft / track.clientWidth));
  }, []);

  useEffect(() => {
    if (HERO.length < 2 || paused || reduced) return;
    const id = window.setInterval(() => {
      if (document.hidden || Date.now() < holdUntil.current) return;
      const track = trackRef.current;
      if (!track || track.clientWidth === 0) return;
      const next = (Math.round(track.scrollLeft / track.clientWidth) + 1) % HERO.length;
      track.scrollTo({ left: track.clientWidth * next, behavior: 'smooth' });
      // The scroll this causes would park the timer; clear the hold next tick
      // or the carousel advances exactly once and then stops.
      window.setTimeout(() => {
        holdUntil.current = 0;
      }, 0);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [paused, reduced]);

  return (
    <section
      className="hp-hero"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="hp-hero-track"
        role="group"
        aria-roledescription="carousel"
        aria-label={t('download.slot.hero')}
      >
        {HERO.map((src) => (
          <div key={src} className="hp-hero-slide">
            {/* Decoration: the page's words are in the DOM, not in the art. */}
            <img src={src} alt="" />
          </div>
        ))}
      </div>

      <button
        type="button"
        className="hp-hero-arrow hp-hero-arrow-prev"
        aria-label={t('download.prevSlide')}
        onClick={() => go(index - 1)}
      >
        <ChevronLeft />
      </button>
      <button
        type="button"
        className="hp-hero-arrow hp-hero-arrow-next"
        aria-label={t('download.nextSlide')}
        onClick={() => go(index + 1)}
      >
        <ChevronRight />
      </button>
      <div className="hp-hero-dots">
        {HERO.map((src, i) => (
          <button
            key={src}
            type="button"
            className="hp-hero-dot"
            aria-label={t('download.slide', { n: i + 1 })}
            aria-current={i === index}
            onClick={() => go(i)}
          >
            <span />
          </button>
        ))}
      </div>

      {children}
    </section>
  );
}

/**
 * The platform buttons laid over the hero.
 *
 * Their `IndexDownBtn`: two flat PNG pills, one image per language, with the
 * build date and version under each. Ours is drawn in CSS at the same
 * 23.5 x 6.8 so the label can be a translated string — eight languages would
 * otherwise be eight more images nobody can grep.
 *
 * A PLATFORM WITH NO LINK SAYS SO. `ANDROID_APK_URL` and `IOS_TESTFLIGHT_URL`
 * are both unset, and those render as "not yet" rather than as buttons that go
 * nowhere. A dead download button on a gambling site reads as a scam. No
 * version or date is printed either: theirs shows "2026-8-20 ｜ 3.2.00.00" and
 * we have no build metadata, so that line carries availability instead of a
 * number that would read as fact.
 */
function HeroButtons() {
  const { t } = useTranslation();
  const targets = platformTargets();

  return (
    <div className="hp-cta">
      {PLATFORMS.map((id) => {
        const Icon = PLATFORM_ICON[id];
        const href = targets[id];
        const label = t(`download.tab.${id}`);
        return (
          <div key={id} className="hp-cta-btn">
            {href ? (
              <a href={href} target="_blank" rel="noreferrer noopener" className="hp-cta-pill">
                <Icon />
                {label}
              </a>
            ) : (
              <span className="hp-cta-pill" aria-disabled="true" style={{ opacity: 0.45 }}>
                <Icon />
                {label}
              </span>
            )}
            <div className="hp-cta-meta">{href ? ' ' : t('download.unavailable')}</div>
          </div>
        );
      })}
      <p className="hp-cta-tip">{t('download.blurb')}</p>
    </div>
  );
}

/**
 * The domain bar.
 *
 * The reference's most telling section: a strip naming its permanent domain and
 * listing mirrors, because its domains get blocked. Ported in full, but it
 * renders only when mirrors are actually configured — inventing a domain here
 * would put a URL on screen that reads as fact and isn't one. Set
 * `VITE_SITE_DOMAIN` and `VITE_MIRROR_DOMAINS` to bring it back.
 *
 * Their own copy is conditional too (`v-if="getUrl()"` — shown only on the
 * canonical host), so a hidden state is part of the design, not a gap in it.
 */
function DomainBar() {
  const { t } = useTranslation();
  if (!SITE_DOMAIN || MIRROR_DOMAINS.length === 0) return null;

  return (
    <div>
      <div className="hp-domain-top">
        <h3>
          {t('download.domainRemember')} <span className="hp-eye-catching">{SITE_DOMAIN}</span>
        </h3>
        <h4>{t('download.domainVerify')}</h4>
      </div>
      <div className="hp-domain-bottom">
        <span>{t('download.domainAlt')}</span>
        <p>
          {MIRROR_DOMAINS.map((d) => (
            <a key={d} href={d.startsWith('http') ? d : `https://${d}`} rel="noreferrer noopener">
              {d}
            </a>
          ))}
        </p>
      </div>
    </div>
  );
}

export function PublicLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="hp">
      <header className="hp-header">
        <img src="/brand/logo-wordmark.png" alt="MYPOKER" className="hp-header-logo" />
        <nav className="hp-nav">
          <NavLink to="/home">{t('nav.home')}</NavLink>
          <NavLink to="/download">{t('nav.download')}</NavLink>
          {/* Dropped on a phone, where three links wrap into the logo — it is
              still in the footer, which is where a stranger looks for it. */}
          {SUPPORT_URL ? (
            <a
              className="hp-nav-support"
              href={SUPPORT_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('download.support')}
            </a>
          ) : null}
        </nav>
      </header>

      <DomainBar />

      <Hero>
        <HeroButtons />
      </Hero>

      {children}

      <footer className="hp-foot hp-wrap">
        <img src="/brand/logo-mark.png" alt="" className="hp-foot-logo" />
        <p>{t('download.copyright')}</p>
        <p className="hp-foot-legal">
          {t('download.ageGate')} · {t('download.responsible')}
        </p>
        {SUPPORT_URL ? (
          <p className="hp-foot-legal">
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="hp-foot-support"
            >
              {t('download.support')}
            </a>
          </p>
        ) : null}
      </footer>
    </div>
  );
}
