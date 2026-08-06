import { useEffect } from 'react';
import { motion } from 'motion/react';
import { Outlet, useLocation } from 'react-router-dom';

import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { useTelegramBackButton } from '@/lib/useTelegramBackButton';
import { useSession } from '@/store/session';
import { useTranslation } from 'react-i18next';
import { useSettings } from '@/api/hooks';
import { setLanguage } from '@/i18n';

/**
 * The frame every screen lives in: fixed brand header, an animated page area, and
 * the bottom navbar. The keyed motion.div remounts on every route change, so each
 * page fades in.
 *
 * Deliberately NOT wrapped in <AnimatePresence mode="wait">. That mode holds the
 * incoming page unmounted until the outgoing one reports its exit animation
 * finished — and a page containing an infinite-repeat animation (the Lobby
 * shimmer) or an in-flight `layoutId` transition (the Segmented pill on Games and
 * Data) may never report it. The result was a permanently blank tab that only
 * recovered by navigating away and back. Animating the entry alone means exactly
 * one page is mounted at any moment, so a blank screen can't happen.
 */
export function AppShell() {
  const location = useLocation();
  useTelegramBackButton();

  // Sign in from the Telegram launch payload on first open only. The 'idle' guard
  // is load-bearing: it means "no sign-in attempted yet". Any other status —
  // authenticated, anonymous after an explicit sign-out, or error — must NOT
  // re-trigger, or signing out just signs you back in.
  const status = useSession((s) => s.status);
  const signIn = useSession((s) => s.signIn);
  useEffect(() => {
    if (status === 'idle') void signIn();
  }, [status, signIn]);

  useAccountLanguage();

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
