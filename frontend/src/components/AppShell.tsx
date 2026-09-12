import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { useTelegramBackButton } from '@/lib/useTelegramBackButton';
import { useSession } from '@/store/session';
import { useTranslation } from 'react-i18next';
import { useSettings } from '@/api/hooks';
import { setLanguage } from '@/i18n';
import { initData, telegramStartParam } from '@/lib/telegram';
import { decodeInvite, invitePath } from '@/lib/tableInvite';
import { Login } from '@/pages/Login';
import { Landing } from '@/pages/Landing';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * An invite that launched the Mini App.
   *
   * Telegram hands `t.me/<bot>/app?startapp=<token>` to us as `start_param`.
   * Without this the deep link opened the lobby and the invite was lost — the
   * player had been sent to a specific table and arrived nowhere in
   * particular. Runs once, and only from the root, so it cannot fight a player
   * who has since navigated somewhere else.
   *
   * `decodeInvite` returns null for anything that is not a table token, so the
   * referral ids that share this parameter pass through untouched.
   */
  const invited = useRef(false);
  useEffect(() => {
    if (invited.current) return;
    const invite = decodeInvite(telegramStartParam());
    if (!invite) return;
    invited.current = true;
    navigate(invitePath(invite), { replace: true });
  }, [navigate]);
  useTelegramBackButton();

  const status = useSession((s) => s.status);
  const token = useSession((s) => s.token);
  const signIn = useSession((s) => s.signIn);
  const refreshPlayer = useSession((s) => s.refreshPlayer);

  useEffect(() => {
    if (status === 'idle') void signIn();
  }, [status, signIn]);

  // Reconcile the cached player with the server, once, on a restored session.
  //
  // The player object is persisted at sign-in and never rewritten, so a change
  // made by an ADMINISTRATOR — a renamed account, a granted role — stayed
  // invisible on that player's own device indefinitely. A reload did not fix
  // it; a reload rehydrates the same cached object from localStorage.
  //
  // Only on a RESTORED session: a fresh sign-in has just written the truth, and
  // asking again immediately would be a wasted request on the slowest screen.
  useEffect(() => {
    if (status === 'authenticated') void refreshPlayer();
    // Deliberately not re-run on every status change — this fires once per
    // mount for a session that was already established.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useAccountLanguage();

  // Outside Telegram (on the web), enforce web sign up / sign in gate before opening the app.
  // EXCEPT at the root: a website's first screen is its front door, and for a
  // stranger that is the landing page — rendered HERE, at `/` itself, so the
  // address bar never flicks to /download. Sign-in appears when they choose
  // Play, never as the opening screen. Deeper links (/wallet, /profile…) keep
  // the gate: those are app destinations, and a session is genuinely required.
  // The early return also skips the shell's chrome, so the landing renders
  // without the app's header and tab bar around it.
  const isTelegram = Boolean(initData());
  if (!isTelegram && !token) {
    // EVERY host, including the app subdomain. There used to be an isAppHost()
    // exception here that made app.mypoker777.com open on the sign-in card, on
    // the reasoning that the app host IS the product. In practice that meant a
    // visitor's first sight of the site was a Google button, with the home
    // page only reachable by typing /download — which is backwards. The front
    // door is the front door wherever it is served from.
    //
    // Telegram is unaffected: initData() is set there, so the Mini App signs
    // in and lands in the lobby without ever reaching this branch.
    if (location.pathname === '/') return <Landing />;
    return <Login />;
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[520px] flex-col px-4 pb-24">
      <Header />
      <main className="flex-1 pt-4">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <Outlet />
        </motion.div>
      </main>
      <BottomNav />
    </div>
  );
}

/**
 * Applies the account's stored language once settings arrive.
 *
 * This is what makes the preference account-scoped rather than device-scoped: a
 * player who picked 日本語 on their phone gets 日本語 when they open the app on
 * a second device, without touching the picker again.
 *
 * Only runs when the two actually differ, so it can't fight the local choice on
 * every render — and it never writes back, so it cannot loop with the picker.
 */
function useAccountLanguage(): void {
  const { i18n } = useTranslation();
  const settings = useSettings();
  const accountLanguage = settings.data?.language ?? null;

  useEffect(() => {
    if (!accountLanguage) return;
    if (accountLanguage === i18n.resolvedLanguage) return;
    void setLanguage(accountLanguage);
  }, [accountLanguage, i18n.resolvedLanguage]);
}
