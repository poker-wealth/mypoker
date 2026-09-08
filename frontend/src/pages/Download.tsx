import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone, Send, Apple, ShieldCheck, CircleAlert } from 'lucide-react';
import { ANDROID_APK_URL, IOS_TESTFLIGHT_URL, TELEGRAM_APP_URL, SUPPORT_URL } from '@/config';

/**
 * The download page.
 *
 * Operating Guide v3.0 cut the website down to two jobs: say what the platform
 * is, and hand people the app. This is the second one, and it is PUBLIC — no
 * session, no AppShell, no bottom nav. Someone arriving here has not signed up
 * and may never have heard of us.
 *
 * ── Two decisions worth knowing about ───────────────────────────────────────
 *
 * TEXT IS TEXT, NOT PICTURES. The reference bakes every word of its install
 * guide into PNGs — eleven of them, `-zh` suffixed, Chinese only. We ship eight
 * languages, so copying that shape would mean eighty-eight images and a build
 * gate (`check:locales`) that cannot see inside any of them. Every step here is
 * a translated string. Screenshots can be added later as illustration beside
 * the words, never instead of them.
 *
 * A PLATFORM WITH NO LINK SAYS SO. `ANDROID_APK_URL` and `IOS_TESTFLIGHT_URL`
 * are both unset today, and the card renders as "not yet" rather than as a
 * button that goes nowhere. A dead download button on a gambling site reads as
 * a scam, and the honest version costs us nothing but a sentence.
 */

type Platform = 'telegram' | 'android' | 'ios';

/**
 * Which platform to open on.
 *
 * A guess, and only ever used to pick the DEFAULT tab — every platform stays
 * one tap away, because user-agent sniffing is wrong often enough (desktop
 * users sending themselves a link, in-app browsers, spoofed strings) that
 * hiding the others would strand people.
 */
function guessPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'telegram';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'telegram';
}

export function Download() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Platform>(() => guessPlatform());

  const targets: Record<Platform, string> = useMemo(
    () => ({ telegram: TELEGRAM_APP_URL, android: ANDROID_APK_URL, ios: IOS_TESTFLIGHT_URL }),
    [],
  );

  const TABS: { id: Platform; label: string; icon: typeof Send }[] = [
    { id: 'telegram', label: t('download.tab.telegram'), icon: Send },
    { id: 'android', label: t('download.tab.android'), icon: Smartphone },
    { id: 'ios', label: t('download.tab.ios'), icon: Apple },
  ];

  /** The install steps per platform. Numbered in the locale files, not here. */
  const steps: Record<Platform, string[]> = {
    telegram: [t('download.step.tg1'), t('download.step.tg2'), t('download.step.tg3')],
    android: [
      t('download.step.and1'),
      t('download.step.and2'),
      t('download.step.and3'),
      t('download.step.and4'),
    ],
    ios: [t('download.step.ios1'), t('download.step.ios2'), t('download.step.ios3'), t('download.step.ios4')],
  };

  const href = targets[tab];

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="mx-auto w-full max-w-md px-5 pb-16 pt-10">
        <header className="mb-8 text-center">
          <img src="/brand/logo-mark.png" alt="" className="mx-auto mb-4 h-14 w-auto" />
          <h1 className="text-2xl font-extrabold tracking-tight">{t('download.title')}</h1>
          <p className="mx-auto mt-2 max-w-sm text-[0.82rem] leading-relaxed text-dim">
            {t('download.blurb')}
          </p>
        </header>

        {/*
          Esther owns the screenshot carousel as a shared component. Until it
          lands this section is absent rather than faked — a placeholder box
          that says "carousel here" would ship to production the first time
          someone forgot, which is how the lobby's dev-seed got out.

          Expected contract when it exists:
            import { ScreenshotCarousel } from '@/components/ScreenshotCarousel';
            <ScreenshotCarousel images={string[]} alt={string} />
        */}

        <nav className="mb-5 grid grid-cols-3 gap-1.5 rounded-(--radius-app) border border-border bg-surface p-1.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id}
              className={
                tab === id
                  ? 'flex flex-col items-center gap-1 rounded-(--radius-app) bg-surface-2 px-2 py-2.5 text-brand'
                  : 'flex flex-col items-center gap-1 rounded-(--radius-app) px-2 py-2.5 text-dim transition-colors active:text-text'
              }
            >
              <Icon size={18} />
              <span className="text-[0.7rem] font-semibold">{label}</span>
            </button>
          ))}
        </nav>

        <section className="rounded-(--radius-app) border border-border bg-surface p-5">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="block w-full rounded-(--radius-app) bg-brand px-4 py-3.5 text-center text-[0.9rem] font-bold text-bg transition active:scale-[0.99]"
            >
              {t(`download.cta.${tab}`)}
            </a>
          ) : (
            /*
              No link configured. Say it plainly and point at the one route that
              does work, rather than rendering a button that cannot do anything.
            */
            <div className="rounded-(--radius-app) border border-border bg-surface-2 p-4 text-center">
              <CircleAlert size={18} className="mx-auto mb-2 text-dim" />
              <p className="text-[0.8rem] font-semibold">{t('download.unavailable')}</p>
              <p className="mt-1 text-[0.72rem] leading-relaxed text-dim">
                {t('download.unavailableHint')}
              </p>
            </div>
          )}

          <h2 className="mt-6 mb-3 text-[0.78rem] font-bold uppercase tracking-wide text-dim">
            {t('download.howTo')}
          </h2>
          <ol className="space-y-3">
            {steps[tab].map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-2 text-[0.66rem] font-bold text-brand">
                  {i + 1}
                </span>
                <span className="text-[0.8rem] leading-relaxed text-text">{step}</span>
              </li>
            ))}
          </ol>

          {tab === 'ios' ? (
            <p className="mt-4 rounded-(--radius-app) border border-border bg-surface-2 p-3 text-[0.72rem] leading-relaxed text-dim">
              {t('download.iosNote')}
            </p>
          ) : null}
        </section>

        <section className="mt-5 flex items-start gap-2.5 rounded-(--radius-app) border border-border bg-surface p-4">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-brand" />
          <p className="text-[0.72rem] leading-relaxed text-dim">{t('download.fairness')}</p>
        </section>

        <footer className="mt-8 space-y-3 text-center">
          <p className="text-[0.72rem] font-semibold text-text">{t('download.ageGate')}</p>
          <p className="text-[0.68rem] leading-relaxed text-dim">{t('download.responsible')}</p>
          {SUPPORT_URL ? (
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-block text-[0.72rem] font-semibold text-brand underline underline-offset-2"
            >
              {t('download.support')}
            </a>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
