/**
 * Brand tokens, mirroring `frontend/src/index.css`.
 *
 * Duplicated deliberately: the Mini App's live in CSS custom properties that
 * React Native cannot read. Two copies of a colour is a smaller problem than a
 * build-time CSS parser, but they ARE two copies — change one, change the other.
 *
 * Dark only for now. The Mini App supports both themes; matching that here is
 * real work (every screen, both palettes) and belongs in its own change rather
 * than half-done in the shell.
 */
export const theme = {
  bg: '#0d0d1a',
  surface: '#17172b',
  surface2: '#1f1f38',
  border: '#2c2c48',
  text: '#f2f2fa',
  dim: '#9797b8',
  brand: '#bb5cf6',
  accent: '#00d4ff',
  success: '#3fd07a',
  danger: '#f85677',
  /** Jackpots only. Never chrome, never admin. */
  jackpot: '#f5b93b',
} as const;

export const radius = { card: 14, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
