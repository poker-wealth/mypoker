import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { haptic } from '@/lib/telegram';

/**
 * The reserve clock, above the action buttons.
 *
 * A 15-second turn clock is right for keeping a table moving and wrong for the
 * one hand a session where somebody genuinely has to think. Folding a big river
 * decision to a timer — rather than to an opponent — is the thing that makes
 * players close the app, so the reserve exists to make that failure impossible.
 *
 * It is shown to the player whose turn it is and to nobody else: how long an
 * opponent can still tank for is information they have and you do not.
 *
 * The button ASKS; it never says how long. The server decides whether it is
 * your turn, whether the hand is live, and how much reserve you actually have —
 * a client that could name its own extension could stall a table forever.
 */
export function TimeBank({
  timeBankMs,
  usingTimeBank,
  autoTimeBank,
  onUse,
  onToggleAuto,
}: {
  timeBankMs: number;
  usingTimeBank: boolean;
  autoTimeBank: boolean;
  onUse: () => void;
  onToggleAuto: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const seconds = Math.ceil(timeBankMs / 1000);

  // Nothing left to offer, and nothing running: say nothing rather than show a
  // dead control. A disabled button with no explanation is worse than absence.
  if (seconds <= 0 && !usingTimeBank) return null;

  return (
    <div className="flex items-center justify-center gap-2 pb-1">
      {usingTimeBank ? (
        // Already running — there is nothing left to press, so this reports
        // rather than invites. Pulsing because the clock is live.
        <motion.span
          animate={{ opacity: [0.55, 1, 0.55] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          className="rounded-full border border-warn/40 bg-warn/15 px-2.5 py-0.5 text-[0.66rem] font-black tracking-wide text-warn"
        >
          {t('table.timeBankRunning')}
        </motion.span>
      ) : (
        <button
          type="button"
          onClick={() => {
            haptic('medium');
            onUse();
          }}
          className="rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 text-[0.66rem] font-black tracking-wide text-accent active:scale-95"
        >
          {t('table.timeBank', { seconds })}
        </button>
      )}

      {/* The other half of the behaviour: let the clock do it for you. Off by
          default, so nobody's reserve drains while they are away from the app. */}
      <label className="flex cursor-pointer items-center gap-1 text-[0.6rem] font-semibold text-dim">
        <input
          type="checkbox"
          checked={autoTimeBank}
          onChange={(e) => onToggleAuto(e.target.checked)}
          className="size-3 accent-[var(--accent)]"
        />
        {t('table.timeBankAuto')}
      </label>
    </div>
  );
}
