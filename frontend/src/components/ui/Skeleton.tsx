import { cn } from '@/lib/cn';

/**
 * A loading placeholder.
 *
 * Shaped like the content it stands in for, so the layout doesn't jump when real
 * data lands — a spinner in the middle of a screen tells the player something is
 * happening but not what is coming, and then everything moves.
 *
 *   <Skeleton className="h-5 w-32" />
 *   <SkeletonText lines={3} />
 *   <SkeletonCard />
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-surface-2', className)}
    />
  );
}

/** A paragraph placeholder. The last line is short, the way real text ends. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

/** Matches the bordered surface used by list rows and tiles across the app. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-(--radius-app) border border-border bg-surface p-4', className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    </div>
  );
}
