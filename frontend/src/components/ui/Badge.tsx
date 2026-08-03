import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'brand' | 'success' | 'accent' | 'neutral' | 'warn';

const tones: Record<Tone, string> = {
  brand: 'bg-[color-mix(in_srgb,var(--brand)_16%,transparent)] text-brand',
  success: 'bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-success',
  accent: 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-accent',
  warn: 'bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] text-danger',
  neutral: 'bg-surface-2 text-dim',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.62rem] font-bold tracking-wide',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
