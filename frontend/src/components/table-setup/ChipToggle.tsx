import { motion } from 'motion/react';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';
import { toast } from '@/lib/toast';
import { PokerChip } from './PokerChip';

/**
 * The reference app's switch: a wide dark track with a poker chip for a knob.
 * OFF is a greyed chip at the left; ON slides a red-striped chip to the right.
 *
 * Same accessibility contract as `ui/Switch` (a real button, role="switch") —
 * this exists beside it rather than replacing it because the chip look belongs
 * to the table screens, and a Settings toggle wearing poker artwork would be
 * noise.
 */
export function ChipToggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        haptic('light');
        onChange(!checked);
      }}
      className={cn(
        'relative h-7 w-[3.4rem] shrink-0 rounded-full border border-border bg-surface-2 transition-colors',
        disabled && 'opacity-45',
      )}
    >
      <motion.span
        className="absolute top-1/2 -translate-y-1/2"
        animate={{ left: checked ? 28 : 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      >
        <PokerChip size={25} muted={!checked} className="block" />
      </motion.span>
    </button>
  );
}

/**
 * One settings row: label on the left, chip toggle on the right — with the
 * reference's optional "?" (a tapped explanation), an optional caption under
 * the label, and an honest disabled state for options whose backing feature
 * has not shipped yet ("soon" — never a live-looking switch that does
 * nothing; see the frontend honesty rules).
 */
export function ToggleRow({
  label,
  checked,
  onChange,
  hint,
  caption,
  soonLabel,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Tapping the "?" shows this. */
  hint?: string;
  /** Small print under the label (e.g. the hide-hole-cards rule). */
  caption?: string;
  /** Present → the option is not wired yet: toggle disabled, badge shown. */
  soonLabel?: string;
}) {
  const disabled = soonLabel !== undefined;
  return (
    <div className={cn('flex items-center gap-3 py-3', disabled && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[0.82rem] text-text">
          {label}
          {hint && (
            <button
              type="button"
              aria-label={`${label} — ?`}
              className="text-dim"
              onClick={() => toast.info(hint)}
            >
              <HelpCircle size={14} />
            </button>
          )}
          {disabled && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.6rem] font-semibold text-dim">
              {soonLabel}
            </span>
          )}
        </span>
        {caption && (
          <p className="mt-0.5 text-[0.62rem] leading-relaxed text-dim">{caption}</p>
        )}
      </div>
      <ChipToggle checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  );
}
