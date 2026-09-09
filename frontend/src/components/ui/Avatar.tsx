import { avatarVisual, UPLOADED_AVATAR, type AvatarRef } from '@/lib/avatars';
import { API_URL } from '@/config';
import { cn } from '@/lib/cn';

interface AvatarProps {
  /** The player's chosen avatar: a curated id, the uploaded-photo sentinel, or null/undefined if they never picked one. */
  avatarId?: AvatarRef | string | null;
  /**
   * Required to render an uploaded photo (`avatarId === UPLOADED_AVATAR`):
   * that photo has no URL of its own, only `GET /avatars/:playerId`, so this
   * component needs the id to build it. Every call site already has the
   * player in scope. Omitting it while `avatarId` is the sentinel falls
   * through to the next step of the chain rather than rendering nothing.
   */
  playerId?: string | null;
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
 * real photo unless they deliberately pick something from the catalogue or
 * upload their own.
 *   1. Chosen avatarId (catalogue gradient + glyph)
 *   2. Uploaded photo (avatarId === UPLOADED_AVATAR) — GET /avatars/:playerId,
 *      unauthenticated and public, same threat model as the curated tiles
 *      (see gateway/avatar-routes.ts). Requires `playerId`.
 *   3. OAuth photoUrl
 *   4. The player's initial
 *
 * Purely decorative (aria-hidden) at every call site today: Profile and
 * Settings always render it beside the player's visible display name, and the
 * picker in PersonalInfo gives its own accessible name to each swatch button.
 * An avatar used standalone in the future should wrap it with its own label
 * rather than rely on this component to supply one.
 */
export function Avatar({ avatarId, playerId, photoUrl, name, size = 64, className }: AvatarProps) {
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

  if (avatarId === UPLOADED_AVATAR && playerId) {
    return (
      <img
        // No cache-busting param: the gateway serves this with a 5-minute
        // max-age specifically so a re-upload becomes visible again on its
        // own within a few minutes (see avatar-routes.ts) — every client
        // doesn't need to invent its own busting scheme on top of that.
        src={`${API_URL}/avatars/${encodeURIComponent(playerId)}`}
        alt=""
        className={cn('shrink-0 rounded-full object-cover', className)}
        style={style}
      />
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
