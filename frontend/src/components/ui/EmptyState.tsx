import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';

interface EmptyStateProps {
  icon?: LucideIcon;
  /** Already translated. Falls back to a generic line. */
  title?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

/**
 * Shown when a request succeeded and there is genuinely nothing to display.
 *
 * Distinct from ErrorState on purpose — "you have no transactions yet" and "we
 * couldn't load your transactions" look similar and mean opposite things. One is
 * a normal state, the other is a failure the player may be able to retry.
 */
export function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-surface-2 text-dim">
        <Icon size={22} />
      </div>
      <div>
        <div className="text-sm font-semibold">{title ?? t('states.empty')}</div>
        {description && <div className="mt-1 text-xs text-dim">{description}</div>}
      </div>
      {action && (
        <Button size="sm" variant="secondary" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
}
