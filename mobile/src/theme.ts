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
 *
 * v3 (Sep 2026): repaletted to the HHPoker reference per Operating Guide v3.0.
 * See docs/REFERENCE-STUDY-HH.md §1 and §14.1. Values are eyeballed from
 * screenshots, not sampled.
 *
 * DELIBERATELY ABSENT, so the next person does not think they were forgotten:
 * the web also defines --brand-strong, --brand-2, --info, --ground-config,
 * --felt, --felt-casino, --coin-gold, --coin-green and --brand-gradient.
 * Nothing in this app reads them yet — mobile draws its felt from
 * `src/table/tableDesigns.ts`, not from a token — so adding them here would be
 * dead values that drift from the web unnoticed. Add one WHEN a screen uses it.
 */
export const theme = {
  bg: '#0c0c0c',
  surface: '#1a1a1a',
  surface2: '#242424',
  border: '#33302b',
  text: '#f5efe3',
  dim: '#9a9182',
  /** Gold. Chrome now — nav, icons, active states. It no longer means money. */
  brand: '#d9b87c',
  /** Copper. Button outlines and secondary emphasis. */
  accent: '#c87a3a',
  success: '#3fd07a',
  danger: '#f85677',
  /**
   * Pots and diamond balances. Cyan, not gold — HH makes gold its chrome
   * colour, so money had to move or the signal would be spent on furniture.
   * Still the rule: whatever wears this is money. Never chrome, never admin.
   */
  jackpot: '#4fd1e0',
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
