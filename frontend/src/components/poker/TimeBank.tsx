import { useEffect, useState } from 'react';
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
  deadline,
  onUse,
  onToggleAuto,
}: {
  timeBankMs: number;
  usingTimeBank: boolean;
  autoTimeBank: boolean;
  /** Epoch ms this player's clock expires, while the reserve is running. */
  deadline?: number | null;
  onUse: () => void;
  onToggleAuto: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const seconds = Math.ceil(timeBankMs / 1000);

  /**
   * The reserve, ticking down once it is actually running.
   *
   * It used to read "Time bank running" — true, but it does not say how long
   * is left, which is the one thing a player who just spent their reserve
   * needs. Victor: "its not even counting down". The ticker only runs while
   * the clock does, so an idle table is not re-rendering for nothing.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!usingTimeBank || !deadline) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [usingTimeBank, deadline]);
  const left = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

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
          {/* The number, not just the fact. Falls back to the old wording only
              when the server has sent no deadline to count against — better a
              vague truth than an invented figure. */}
          {left === null ? t('table.timeBankRunning') : t('table.timeBankLeft', { seconds: left })}
        </motion.span>
      ) : (
        // "Use 60s", not "Time Bank: 60s". The old label read as a countdown
        // that was mysteriously stuck — Victor's first reading of it was "its
        // not even counting down". It is a BUTTON offering the reserve, and
        // saying "Use" is what makes that legible at a glance.
        <button
          type="button"
          onClick={() => {
            haptic('medium');
            onUse();
          }}
          className="rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 text-[0.66rem] font-black tracking-wide text-accent active:scale-95"
        >
          {t('table.timeBankUse', { seconds })}
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
