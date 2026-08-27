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
import { initData } from '@/lib/telegram';
import { Login } from '@/pages/Login';

export function AppShell() {
  const location = useLocation();
  useTelegramBackButton();

  const status = useSession((s) => s.status);
  const token = useSession((s) => s.token);
  const signIn = useSession((s) => s.signIn);

  useEffect(() => {
    if (status === 'idle') void signIn();
  }, [status, signIn]);

  useAccountLanguage();

  // Outside Telegram (on the web), enforce web sign up / sign in gate before opening the app
  const isTelegram = Boolean(initData());
  if (!isTelegram && !token) {
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
