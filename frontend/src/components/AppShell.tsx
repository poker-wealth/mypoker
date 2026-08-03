import { AnimatePresence, motion } from 'motion/react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { useTelegramBackButton } from '@/lib/useTelegramBackButton';

/**
 * The frame every screen lives in: fixed brand header, an animated page area, and
 * the bottom navbar. Pages cross-fade/slide as the route changes.
 */
export function AppShell() {
  const location = useLocation();
  useTelegramBackButton();
  return (
    <div className="mx-auto flex min-h-full max-w-[520px] flex-col px-4 pb-24">
      <Header />
      <main className="flex-1 pt-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
      <BottomNav />
    </div>
  );
}
