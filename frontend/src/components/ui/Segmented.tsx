import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** iOS-style segmented control with an animated selection pill. */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="flex gap-1 rounded-(--radius-app) border border-border bg-surface p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => {
              haptic('light');
              onChange(o.value);
            }}
            className={cn(
              'relative flex-1 rounded-[calc(var(--radius-app)-0.25rem)] py-2 text-sm font-semibold',
              active ? 'text-white' : 'text-dim',
            )}
          >
            {active && (
              <motion.span
                layoutId="segmented-pill"
                className="absolute inset-0 rounded-[calc(var(--radius-app)-0.25rem)]"
                style={{ backgroundImage: 'var(--brand-gradient)' }}
                transition={{ type: 'spring', damping: 30, stiffness: 380 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
