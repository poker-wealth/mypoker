import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LifeBuoy, Mail, Play, X } from 'lucide-react';
import { PublicLayout } from '@/components/public/PublicLayout';
import { SUPPORT_EMAIL, SUPPORT_URL } from '@/config';

/**
 * The public home page — a port of the reference site's landing route.
 *
 * The chrome (header, domain bar, hero, footer) belongs to `PublicLayout`,
 * exactly as it belongs to their Vue Layout; what follows is the part their
 * `<router-view>` renders for the index route, section for section:
 *
 *   h2 + four 29x29rem video tiles → the gameplay reel
 *   three 52rem feature banners    → what the product does
 *   "Contact us" + two items       → email and support
 *
 * ── Where it deliberately differs ───────────────────────────────────────────
 *
 * THE REEL IS BUILT ON MOBILE. Theirs renders the video row only on desktop
 * (`$device.ios || $device.android ? _e() : ...`) and shows download buttons
 * instead. Most of our visitors arrive on a phone, so it goes two-up rather
 * than disappearing.
 *
 * TILES ARE CAPTIONED. Their thumbnails have the game name baked into the PNG,
 * Chinese only. Ours name the game in a translated string underneath, reusing
 * the `gameNames.*` keys the app already ships in all eight languages — no new
 * copy, and `check:locales` can see it.
 *
 * CONTACTS COME FROM CONFIG. Theirs are hardcoded. An email address or a chat
 * handle is the kind of thing that reads as fact, so each row appears only when
 * it is actually configured, and the section disappears entirely when neither is.
 */

/**
 * Stand-in footage — REPLACE BEFORE LAUNCH.
 * See `public/home/placeholder/README.md`.
 *
 * The reference's own gameplay clips and thumbnails: ~29MB together, carrying
 * HH Poker's branding and Chinese titles baked into both the covers and the
 * video. They are here so the page has real footage and real proportions to lay
 * out against, and for nothing else. (The feature banners below are ours.)
 *
 * `gameNames.*` labels are ours and already translated. They name games this
 * platform actually runs (see `LIVE_TABLE_IDS` in config) — the borrowed
 * footage does not match them, and will not until it is replaced.
 */
const REEL = [
  { key: 'texas', cover: '/home/placeholder/video-cover-1.png', src: '/home/placeholder/video/welcome-1.mp4' },
  { key: 'short-deck', cover: '/home/placeholder/video-cover-2.png', src: '/home/placeholder/video/welcome-2.mp4' },
  { key: 'omaha', cover: '/home/placeholder/video-cover-3.png', src: '/home/placeholder/video/welcome-3.mp4' },
  { key: 'niu-niu', cover: '/home/placeholder/video-cover-4.png', src: '/home/placeholder/video/welcome-4.mp4' },
] as const;

/**
 * The feature banners. Ours, not borrowed — and each `caption` is the sentence
 * that picture makes, so the two must stay paired if the order ever changes.
 *
 * They arrive at whatever ratio the designer hands over (2.4 to 2.9 so far),
 * which is why the section sizes them by width rather than pinning a height:
 * see the note on `.hp-feature img` in `publicSite.css`.
 */
const FEATURES = [
  { src: '/home/feature-1.jpg', caption: 'home.feature1' },
  { src: '/home/feature-2.jpg', caption: 'home.feature2' },
  { src: '/home/feature-3.jpg', caption: 'home.feature3' },
] as const;

/**
 * The lightbox.
 *
 * Theirs is a `position: fixed` video over a 50%-opacity scrim, toggled by
 * clicking the thumbnail and dismissed by clicking again. Same shape here, with
 * the three things a keyboard user needs and their version has none of: Escape
 * closes it, there is a real close button, and the page behind stops scrolling
 * while it is open.
 */
function VideoLightbox({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const { t } = useTranslation();

  return (
    <>
      <button type="button" className="hp-video-mask" aria-label={t('home.closeVideo')} onClick={onClose} />
      <div className="hp-video-stage" role="dialog" aria-modal="true" aria-label={label}>
        {/* autoPlay is the point of the click; controls stay so it can be
            paused, scrubbed and muted like any other video. */}
        <video src={src} controls autoPlay playsInline />
        <button type="button" className="hp-video-close" aria-label={t('home.closeVideo')} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
    </>
  );
}

export function Home() {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState<(typeof REEL)[number] | null>(null);

  /* Icons are drawn rather than borrowed: the reference ships a branded PNG per
     row, and neither of those brands is one this site names. */
  const contacts = [
    SUPPORT_EMAIL
      ? { id: 'email', Icon: Mail, text: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}` }
      : null,
    SUPPORT_URL
      ? { id: 'support', Icon: LifeBuoy, text: t('download.support'), href: SUPPORT_URL }
      : null,
  ].filter((c) => c !== null);

  return (
    <PublicLayout>
      <div className="hp-home hp-wrap">
        <h2 className="hp-section-tit">{t('home.gameplay')}</h2>
        <div className="hp-video-row">
          {REEL.map((item) => {
            const name = t(`gameNames.${item.key}`);
            return (
              <div key={item.key} className="hp-video-item">
                <button
                  type="button"
                  className="hp-video-btn"
                  aria-label={t('home.playVideo', { name })}
                  onClick={() => setPlaying(item)}
                >
                  <img src={item.cover} alt="" loading="lazy" />
                  <span className="hp-video-play">
                    <Play fill="currentColor" />
                  </span>
                </button>
                <div className="hp-video-label">{name}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="hp-wrap">
        {FEATURES.map((f) => (
          <div key={f.src} className="hp-feature">
            {/* The words are baked into the reference's banners; ours carry the
                sentence as alt text so it survives the art being replaced. */}
            <img src={f.src} alt={t(f.caption)} loading="lazy" />
          </div>
        ))}
      </div>

      {contacts.length > 0 ? (
        <div className="hp-wrap">
          <div className="hp-contact">
            <div className="hp-contact-title">{t('home.contactUs')}</div>
            <div className="hp-contact-row">
              {contacts.map((c) => (
                <div key={c.id} className="hp-contact-item">
                  <a
                    href={c.href}
                    target={c.href.startsWith('mailto:') ? undefined : '_blank'}
                    rel="noreferrer noopener"
                  >
                    <c.Icon />
                    <span className="hp-contact-text">{c.text}</span>
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {playing ? (
        <VideoLightbox
          src={playing.src}
          label={t(`gameNames.${playing.key}`)}
          onClose={() => setPlaying(null)}
        />
      ) : null}
    </PublicLayout>
  );
}
