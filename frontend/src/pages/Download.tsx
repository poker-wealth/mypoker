import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { PublicLayout } from '@/components/public/PublicLayout';
import { PLATFORM_ICON, guessPlatform } from '@/components/public/platform';
import type { Platform } from '@/components/public/platform';

/**
 * The public download page — a port of the reference site's `/download` route.
 *
 * The chrome (header, domain bar, hero with the platform buttons, footer) is
 * `PublicLayout`, matching their Vue Layout. What follows is the part their
 * `<router-view>` renders here, section for section:
 *
 *   qr-box                        → scan-to-download, desktop only, as theirs is
 *   dowmload-title                → the gold icon and one line of caution
 *   tabs-container + tuorials     → the tabbed install guide, 4-up grid
 *   question-container            → the FAQ
 *
 * ── Where it deliberately differs, and why ──────────────────────────────────
 *
 * CAPTIONS ARE TEXT, THE PICTURES ARE PICTURES. Their eleven guide images have
 * the words baked in, Chinese only. We ship eight languages, so the caption
 * above each frame is a translated string and the art beside it takes `alt=""`.
 * `check:locales` can see a string; it cannot see inside a PNG, and the install
 * guide is the last place that gate should go blind.
 *
 * MOBILE IS BUILT RATHER THAN HIDDEN — see the note in `publicSite.css`.
 */

/**
 * Stand-in art — REPLACE BEFORE LAUNCH.
 * See `public/download/placeholder/README.md`.
 *
 * The reference's own tutorial screenshots, borrowed so the layout can be
 * judged at the right proportions. They carry someone else's logo and
 * Chinese-only baked-in text. (The hero art above is ours and lives in
 * `PublicLayout`.)
 *
 * The pairing of shot to step is arbitrary: there are more Android frames than
 * we have Android steps and fewer iPhone ones than iPhone steps, so the list
 * wraps. Do not
 * read meaning into which picture sits under which caption — there isn't any
 * yet, and the caption carries the instruction.
 */
const SHOTS: Record<Platform, string[]> = {
  // Deliberately empty: there is nothing to screenshot. Telegram is a link you
  // open, not an install you walk through, so its steps carry captions and no
  // frames rather than borrowing pictures of a different platform's dialogs.
  telegram: [],
  android: [1, 2, 3, 4].map((n) => `/download/placeholder/shot-android-${n}.png`),
  ios: [1, 2, 3].map((n) => `/download/placeholder/shot-ios-${n}.png`),
};

const shotFor = (platform: Platform, i: number): string | undefined => {
  const shots = SHOTS[platform];
  return shots.length > 0 ? shots[i % shots.length] : undefined;
};

/** Their `.dowmload-title` — gold icon, one line of caution beside it. */
function TipTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="hp-tip-title">
      <Info className="hp-tip-icon" />
      <p className="title">{children}</p>
    </div>
  );
}

export function Download() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Platform>(() => guessPlatform());

  /* Telegram leads: it is the only route that works today. See PLATFORMS in
     components/public/platform.ts, which this deliberately mirrors. */
  const TABS: { id: Platform; guide: string }[] = [
    { id: 'telegram', guide: t('download.guide.telegram') },
    { id: 'android', guide: t('download.guide.android') },
    { id: 'ios', guide: t('download.guide.ios') },
  ];

  const steps: Record<Platform, string[]> = {
    telegram: [t('download.step.tg1'), t('download.step.tg2'), t('download.step.tg3')],
    android: [
      t('download.step.and1'),
      t('download.step.and2'),
      t('download.step.and3'),
      t('download.step.and4'),
    ],
    ios: [
      t('download.step.ios1'),
      t('download.step.ios2'),
      t('download.step.ios3'),
      t('download.step.ios4'),
    ],
  };

  return (
    <PublicLayout>
      {/* The hero's words live in the art, so the real heading is here, for
          search engines and for anyone who cannot see the picture. */}
      <h1 className="sr-only">{t('download.title')}</h1>

      <div className="hp-wrap">
        {/*
          Scan-to-download, desktop-only exactly as the reference has it — the
          block exists to move someone from a big screen to their phone, which
          is not a thing a phone visitor needs.

          TODO: this frame holds the logo mark, not a QR code. Encoding one
          needs a QR library and, more to the point, a URL to encode: every
          download link is unset today. Wire both together.
        */}
        <div className="hp-qr">
          <div className="hp-qr-frame">
            <img src="/brand/logo-mark.png" alt="" />
          </div>
          <div className="hp-qr-text">{t('download.scanToDownload')}</div>
        </div>

        <TipTitle>{t('download.iosNote')}</TipTitle>

        <div className="hp-tabs">
          <div className="hp-tabs-nav" role="tablist">
            {TABS.map(({ id, guide }) => {
              const Icon = PLATFORM_ICON[id];
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`hp-tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls={`hp-panel-${id}`}
                  className="hp-tab"
                  onClick={() => setTab(id)}
                >
                  <Icon />
                  <span className="hp-tab-text">{guide}</span>
                </button>
              );
            })}
          </div>

          {/* The panel wraps the list rather than being it: `role="tabpanel"` on
              the <ol> would replace its list semantics. */}
          <div role="tabpanel" id={`hp-panel-${tab}`} aria-labelledby={`hp-tab-${tab}`}>
            <ol className="hp-guide">
              {steps[tab].map((step, i) => {
                const shot = shotFor(tab, i);
                return (
                  <li key={step} className="hp-guide-item">
                    <h3 className="hp-guide-step">{step}</h3>
                    {shot ? (
                      <img src={shot} alt="" loading="lazy" className="hp-guide-shot" />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <section className="hp-faq">
          <TipTitle>{t('download.faqTitle')}</TipTitle>
          <div className="hp-faq-item">
            <h3>{t('download.faqQ1')}</h3>
            <p>{t('download.faqA1')}</p>
          </div>
          <div className="hp-faq-item">
            <h3>{t('download.faqQ2')}</h3>
            <p>{t('download.faqA2')}</p>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}
