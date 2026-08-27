/**
 * The avatar catalogue.
 *
 * Ids are the **server's** ids (financial-core/src/settings/player-settings.ts,
 * `AVATAR_IDS`) — mirrored exactly, not a parallel client vocabulary, for the
 * same reason frontend/src/lib/games.ts mirrors the game-server's GameId: the
 * server is the authority on what a stored value is allowed to be, and a
 * client-only id would eventually drift.
 *
 * What lives here is the *visual* identity — glyph and gradient — which is a
 * client concern the server has no opinion about. Deliberately zero new image
 * files: each id pairs a two-stop brand gradient with a glyph, the same way
 * the game catalogue tiles render (see games.ts). Gradients are built only
 * from the existing brand tokens in index.css (--brand, --brand-2, --accent,
 * --success, --danger, --jackpot) — no new raw hex.
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

export interface AvatarDef {
  id: AvatarId;
  glyph: string;
  /** two-stop gradient [from, to], each a CSS custom-property reference. */
  gradient: [string, string];
}

export const AVATARS: AvatarDef[] = [
  { id: 'a-spade', glyph: '♠', gradient: ['var(--brand)', 'var(--brand-2)'] },
  { id: 'a-heart', glyph: '♥', gradient: ['var(--danger)', 'var(--brand)'] },
  { id: 'a-diamond', glyph: '♦', gradient: ['var(--accent)', 'var(--brand-2)'] },
  { id: 'a-club', glyph: '♣', gradient: ['var(--success)', 'var(--brand-2)'] },
  { id: 'a-crown', glyph: '👑', gradient: ['var(--jackpot)', 'var(--brand)'] },
  { id: 'a-bull', glyph: '🐂', gradient: ['var(--danger)', 'var(--jackpot)'] },
  { id: 'a-packet', glyph: '🧧', gradient: ['var(--danger)', 'var(--accent)'] },
  { id: 'a-fan', glyph: '🪭', gradient: ['var(--brand)', 'var(--accent)'] },
  { id: 'a-star', glyph: '⭐', gradient: ['var(--jackpot)', 'var(--accent)'] },
  { id: 'a-flame', glyph: '🔥', gradient: ['var(--jackpot)', 'var(--danger)'] },
  { id: 'a-clover', glyph: '🍀', gradient: ['var(--success)', 'var(--accent)'] },
  { id: 'a-dragon', glyph: '🐉', gradient: ['var(--brand-2)', 'var(--success)'] },
];

const BY_ID = new Map(AVATARS.map((a) => [a.id, a]));

/**
 * Visual identity for a stored avatar id, if we still recognize it.
 *
 * Returns `undefined` rather than throwing: a stored value can outlive a
 * catalogue change (an id retired after someone picked it), and the caller
 * — Avatar's fallback chain — is what decides what to show instead.
 */
export function avatarVisual(id: string): AvatarDef | undefined {
  return BY_ID.get(id as AvatarId);
}
