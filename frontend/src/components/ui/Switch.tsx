import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Required when the switch has no adjacent visible label. */
  label?: string;
}

/**
 * A toggle.
 *
 * Built on a real <button> with role="switch" rather than a styled div, so it
 * reaches keyboard and screen-reader users for free — a settings screen is
 * exactly where that matters.
 *
 * The knob is animated with a spring rather than a CSS transition so an
 * interrupted tap picks up from where the knob actually is, instead of jumping.
 */
export function Switch({ checked, onChange, disabled, label }: SwitchProps) {
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
        'relative h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? 'bg-brand' : 'bg-surface-2 border border-border',
        disabled && 'opacity-50',
      )}
    >
      <motion.span
        className="absolute top-0.5 size-5 rounded-full bg-white shadow"
        animate={{ left: checked ? 22 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      />
    </button>
  );
}
