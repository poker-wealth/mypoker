import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: Size;
  full?: boolean;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-(--radius-app) font-bold whitespace-nowrap select-none disabled:opacity-45 disabled:pointer-events-none';

const variants: Record<Variant, string> = {
  // The MYPOKER gradient CTA.
  primary: 'text-white shadow-[var(--glow-brand)]',
  secondary: 'bg-surface-2 text-text border border-border',
  ghost: 'bg-transparent text-dim',
  danger: 'bg-[color-mix(in_srgb,var(--danger)_18%,transparent)] text-danger border border-[color-mix(in_srgb,var(--danger)_35%,transparent)]',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm',
  md: 'h-11 px-4 text-[0.95rem]',
  lg: 'h-14 px-5 text-base',
};

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  full,
  disabled,
  className,
  type,
}: ButtonProps) {
  return (
    <motion.button
      type={type}
      whileTap={{ scale: 0.96 }}
      disabled={disabled}
      onClick={() => {
        haptic('light');
        onClick?.();
      }}
      className={cn(base, variants[variant], sizes[size], full && 'w-full', className)}
      style={variant === 'primary' ? { backgroundImage: 'var(--brand-gradient)' } : undefined}
    >
      {children}
    </motion.button>
  );
}
