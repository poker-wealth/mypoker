import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ListRowProps {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
}

/** A single settings/list line: optional leading icon, title/subtitle, trailing slot or chevron. */
export function ListRow({ title, subtitle, leading, trailing, onClick, className }: ListRowProps) {
  const interactive = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-4 py-3.5',
        interactive && 'cursor-pointer active:bg-surface-2',
        className,
      )}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-text">{title}</div>
        {subtitle && <div className="truncate text-xs text-dim">{subtitle}</div>}
      </div>
      {trailing ?? (interactive && <ChevronRight size={18} className="text-dim" />)}
    </div>
  );
}
