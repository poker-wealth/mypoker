import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  /** Subtle brand glow (hero / featured cards). */
  glow?: boolean;
}

export function Card({ children, className, onClick, glow }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-(--radius-app) border border-border bg-surface',
        onClick && 'cursor-pointer active:bg-surface-2',
        className,
      )}
      style={glow ? { boxShadow: 'var(--glow-brand)' } : { boxShadow: 'var(--shadow-card)' }}
    >
      {children}
    </div>
  );
}
