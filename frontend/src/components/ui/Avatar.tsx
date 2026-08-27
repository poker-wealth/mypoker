import { avatarVisual, type AvatarId } from '@/lib/avatars';
import { cn } from '@/lib/cn';

interface AvatarProps {
  /** The player's chosen avatar id, or null/undefined if they never picked one. */
  avatarId?: AvatarId | string | null;
  /** OAuth profile photo (Google/Telegram), or null if the account has none. */
  photoUrl?: string | null;
  /** Used for the initial fallback only — not read by assistive tech, see below. */
  name: string;
  /** Square size in px. Default matches the old Profile.tsx avatar. */
  size?: number;
  className?: string;
}

/**
 * The one place that decides what a player's avatar looks like — everywhere
 * this renders, it must render identically.
 *
 * Fallback order, and it matters: a Google or Telegram player keeps their
 * real photo unless they deliberately pick something from the catalogue.
 *   1. Chosen avatarId (catalogue gradient + glyph)
 *   2. OAuth photoUrl
 *   3. The player's initial
 *
 * Purely decorative (aria-hidden) at every call site today: Profile and
 * Settings always render it beside the player's visible display name, and the
 * picker in PersonalInfo gives its own accessible name to each swatch button.
 * An avatar used standalone in the future should wrap it with its own label
 * rather than rely on this component to supply one.
 */
export function Avatar({ avatarId, photoUrl, name, size = 64, className }: AvatarProps) {
  const visual = avatarId ? avatarVisual(avatarId) : undefined;
  const style = { width: size, height: size };
  const initial = name.charAt(0).toUpperCase() || '?';

  if (visual) {
    return (
      <div
        aria-hidden="true"
        className={cn('grid shrink-0 place-items-center rounded-full text-white', className)}
        style={{
          ...style,
          backgroundImage: `linear-gradient(135deg, ${visual.gradient[0]}, ${visual.gradient[1]})`,
          fontSize: size * 0.5,
        }}
      >
        {visual.glyph}
      </div>
    );
  }

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        referrerPolicy="no-referrer"
        className={cn('shrink-0 rounded-full object-cover', className)}
        style={style}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center rounded-full font-black text-white', className)}
      style={{ ...style, backgroundImage: 'var(--brand-gradient)', fontSize: size * 0.4 }}
    >
      {initial}
    </div>
  );
}
