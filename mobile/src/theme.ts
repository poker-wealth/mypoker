/**
 * The app's colours, taken from the Mini App's CSS custom properties
 * (`frontend/src/index.css`) so the two platforms look like one product.
 *
 * Dark only for now. The web has a light theme behind `prefers-color-scheme`; porting it means
 * threading a theme context through every screen, which is worth doing once the screens exist
 * rather than before.
 */
export const colors = {
  bg: '#0d0d1a',
  surface: '#17172b',
  surface2: '#21213a',
  border: '#2c2c48',

  text: '#f2f2fa',
  dim: '#9797b8',

  brand: '#bb5cf6',
  brandStrong: '#9a3fe4',
  brand2: '#6366f1',
  accent: '#00d4ff',

  success: '#3fd07a',
  danger: '#f85677',
  gold: '#f5c451',
} as const;

/**
 * The brand gradient, as its three stops.
 *
 * CSS says `linear-gradient(120deg, …)` in one line; React Native has no gradients at all without
 * expo-linear-gradient, so components either take these stops or approximate with `brand`.
 */
export const brandGradient = ['#6366f1', '#bb5cf6', '#00d4ff'] as const;

/** The Mini App is capped at 520px and centred; phones are narrower, but tablets are not. */
export const MAX_CONTENT_WIDTH = 520;
