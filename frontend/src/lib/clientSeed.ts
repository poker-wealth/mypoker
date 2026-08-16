const KEY = 'mypoker.clientSeed';
const HEX32 = /^[0-9a-f]{64}$/;

/**
 * The player's own device-generated client seed (32 bytes hex) — their entropy contribution to the
 * provably-fair shuffle. Generated in the browser with the Web Crypto RNG so the platform never sees
 * it chosen; persisted in localStorage so the player sees a STABLE seed they can note down and later
 * verify appeared in the round data. Call {@link rotateClientSeed} to deliberately change it.
 */
export function deviceClientSeed(): string {
  const existing = localStorage.getItem(KEY);
  if (existing && HEX32.test(existing)) return existing;
  return rotateClientSeed();
}

/** Generate and persist a fresh client seed, returning it. */
export function rotateClientSeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const seed = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(KEY, seed);
  return seed;
}
