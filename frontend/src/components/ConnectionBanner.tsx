import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { WifiOff, Loader2, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useConnection } from '@/store/connection';

/**
 * The offline / reconnecting banner.
 *
 * Sits under the header rather than over it, so it never covers the brand or the
 * theme toggle, and pushes nothing around — it's an overlay strip, so a
 * connection blip mid-hand doesn't reflow the table.
 *
 * On recovery it briefly shows "back online" and then leaves. Vanishing silently
 * is worse: a player who saw the warning has no confirmation it cleared, and
 * will keep wondering whether their action went through.
 */
export function ConnectionBanner() {
  const { t } = useTranslation();
  const status = useConnection((s) => s.status);
  const queryClient = useQueryClient();

  const [showRecovered, setShowRecovered] = useState(false);
  const wasDown = useRef(false);

  useEffect(() => {
    if (status !== 'online') {
      wasDown.current = true;
      setShowRecovered(false);
      return;
    }

    if (!wasDown.current) return;
    wasDown.current = false;

    // "recovers without reload" — refetch whatever the screens are holding, so
    // the data catches up on its own rather than waiting for the player to
    // navigate somewhere.
    void queryClient.refetchQueries({ type: 'active' });

    setShowRecovered(true);
    const timer = window.setTimeout(() => setShowRecovered(false), 2200);
    return () => window.clearTimeout(timer);
  }, [status, queryClient]);

  const visible = status !== 'online' || showRecovered;

  const tone =
    status === 'offline'
      ? 'bg-danger text-white'
      : status === 'reconnecting'
        ? 'bg-[color-mix(in_srgb,var(--danger)_70%,var(--brand))] text-white'
        : 'bg-success text-white';

  const label =
    status === 'offline'
      ? t('states.offline')
      : status === 'reconnecting'
        ? t('states.reconnecting')
        : t('states.backOnline');

  const Icon = status === 'offline' ? WifiOff : status === 'reconnecting' ? Loader2 : Wifi;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 400 }}
          className={`fixed inset-x-0 top-0 z-[90] mx-auto flex max-w-[520px] items-center justify-center gap-2 py-1.5 text-xs font-semibold ${tone}`}
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.375rem)' }}
        >
          <Icon size={14} className={status === 'reconnecting' ? 'animate-spin' : undefined} />
          {label}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
