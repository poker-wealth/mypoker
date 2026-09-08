import { theme } from '../theme';

/**
 * The web's `--brand-2`, which the native theme has no token for.
 *
 * Written once here rather than reached for inline: `theme.ts` says the palette
 * is the Mini App's, and adding a second brand stop to it would be a palette
 * change on every screen rather than a detail of this catalogue. Kept as the
 * literal the web resolves `--brand-2` to (frontend/src/index.css), not an
 * approximation of it — a brand colour that is merely close is worse than one
 * that is shared, because nobody notices it drifting.
 */
const BRAND_2 = '#6366f1';

/**
 * The avatar catalogue, mirrored from `frontend/src/lib/avatars.ts`.
 *
 * The IDS are the server's (financial-core/src/settings/player-settings.ts,
 * `AVATAR_IDS`) — mirrored exactly, not a parallel native vocabulary, for the
 * same reason the web mirrors them: the server is the authority on what a
 * stored value may be, and a client-only id would eventually drift. Adding one
 * here without adding it there means a pick the server rejects.
 *
 * What differs from the web is only the COLOUR EXPRESSION. The web pairs each
 * glyph with a two-stop CSS gradient built from custom properties
 * (`var(--brand)`); there are no CSS variables here and no gradient primitive
 * without a dependency, so each id resolves to two theme colours and the screen
 * renders a flat tile from the first with the second as its border. Same
 * identity, same order, same glyphs — expressed in what React Native has.
 */

export const AVATAR_IDS = [
  'a-spade',
  'a-heart',
  'a-diamond',
  'a-club',
  'a-crown',
  'a-bull',
  'a-packet',
  'a-fan',
  'a-star',
  'a-flame',
  'a-clover',
  'a-dragon',
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

/**
 * "Use the player's own uploaded photo" — mirrors `UPLOADED_AVATAR` in
 * financial-core exactly. Deliberately NOT part of `AVATAR_IDS`, so
 * `avatarVisual` does not recognise it and a stray render falls through to the
 * next fallback rather than drawing a blank curated tile.
 */
export const UPLOADED_AVATAR = 'uploaded' as const;

/** Everything a player's `avatarId` can legitimately hold. */
export type AvatarRef = AvatarId | typeof UPLOADED_AVATAR;

export interface AvatarDef {
  id: AvatarId;
  glyph: string;
  /** [fill, accent] — the native stand-in for the web's two-stop gradient. */
  colors: [string, string];
}

export const AVATARS: AvatarDef[] = [
  { id: 'a-spade', glyph: '♠', colors: [theme.brand, BRAND_2] },
  { id: 'a-heart', glyph: '♥', colors: [theme.danger, theme.brand] },
  { id: 'a-diamond', glyph: '♦', colors: [theme.accent, BRAND_2] },
  { id: 'a-club', glyph: '♣', colors: [theme.success, BRAND_2] },
  { id: 'a-crown', glyph: '👑', colors: [theme.jackpot, theme.brand] },
  { id: 'a-bull', glyph: '🐂', colors: [theme.danger, theme.jackpot] },
  { id: 'a-packet', glyph: '🧧', colors: [theme.danger, theme.accent] },
  { id: 'a-fan', glyph: '🪭', colors: [theme.brand, theme.accent] },
  { id: 'a-star', glyph: '⭐', colors: [theme.jackpot, theme.accent] },
  { id: 'a-flame', glyph: '🔥', colors: [theme.jackpot, theme.danger] },
  { id: 'a-clover', glyph: '🍀', colors: [theme.success, theme.accent] },
  { id: 'a-dragon', glyph: '🐉', colors: [BRAND_2, theme.success] },
];

const BY_ID = new Map(AVATARS.map((a) => [a.id, a]));

/**
 * Visual identity for a stored avatar id, if we still recognise it.
 *
 * Returns `undefined` rather than throwing: a stored value can outlive a
 * catalogue change (an id retired after someone picked it), and the caller is
 * what decides what to show instead.
 */
export function avatarVisual(id: string): AvatarDef | undefined {
  return BY_ID.get(id as AvatarId);
}
