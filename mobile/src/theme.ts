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
  surface2: '#21213a',
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

/**
 * Nunito, because that is what the Mini App renders in — its CSS stack is
 * 'Nunito', 'Lora', 'Inter', 'Poppins', … and Nunito is the one that loads.
 *
 * RN has no font-stack fallback: a style names ONE family, and an absent one
 * silently falls back to the system face rather than trying the next. So each
 * weight is its own family name, and `weight()` maps a CSS-ish weight onto the
 * right file. Passing fontWeight alongside these does nothing useful on
 * Android and can double-bold on iOS — name the family instead.
 */
export const font = {
  regular: 'Nunito_400Regular',
  medium: 'Nunito_500Medium',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  extrabold: 'Nunito_800ExtraBold',
  black: 'Nunito_900Black',
} as const;

/** The family for a numeric weight, so ported styles keep reading naturally. */
export function weight(w: '400' | '500' | '600' | '700' | '800' | '900'): string {
  return {
    '400': font.regular,
    '500': font.medium,
    '600': font.semibold,
    '700': font.bold,
    '800': font.extrabold,
    '900': font.black,
  }[w];
}

export const radius = { card: 14, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
