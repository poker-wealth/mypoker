import { AlertTriangle, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';

interface ErrorStateProps {
  /** Already translated, or a message straight off an ApiError. */
  message?: string;
  onRetry?: () => void;
}

/**
 * Shown when a request failed.
 *
 * The retry button is the point — most failures here are a dropped mobile
 * connection, and the fix is "try again", not "reload the app" or "contact
 * support". Callers that genuinely cannot retry should omit `onRetry` rather
 * than pass a no-op.
 */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-danger">
        <AlertTriangle size={22} />
      </div>
      <div>
        <div className="text-sm font-semibold">{t('states.error')}</div>
        {message && <div className="mt-1 break-words text-xs text-dim">{message}</div>}
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry} className="mt-1">
          <RotateCw size={15} /> {t('common.retry')}
        </Button>
      )}
    </div>
  );
}
