/**
 * The admin panel is served from its own subdomain (admin.mypoker777.com), while
 * the player app is the apex/www. A few things branch on which one we are:
 *
 *   - the bare `/` is rewritten to `/admin` so the subdomain lands on the panel;
 *   - the player-only globals (Telegram connection watcher, onboarding, the
 *     first-run language gate) don't run — the panel has no live table and no
 *     player onboarding, and the connection watcher is what raised the stray
 *     "Reconnecting…" banner on the admin host.
 *
 * Matches any `admin.` host so it also holds on staging/preview subdomains.
 */
export function isAdminHost(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.startsWith('admin.');
}
