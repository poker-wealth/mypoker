import { useEffect, useState } from 'react';
import { amountOnly } from '@/lib/money';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bell, Trophy, Wallet, Megaphone, Crown, Info, ChevronRight, ArrowUpRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useNotifications, useMarkNotificationsRead } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { useSession } from '@/store/session';
import { cn } from '@/lib/cn';
import { txnRefFromEventId } from '@/lib/notificationLink';
import { MESSAGE_TABS } from '@/api/notifications';
import type { NotificationKind } from '@/api/notifications';

/**
 * In-app notifications.
 *
 * Marked read on open rather than per item. Anything on this screen has been
 * seen, and leaving a badge up after someone has looked at the list makes the
 * badge mean nothing — which is worse than not having one.
 *
 * Each row renders from a translation KEY the server stored, not text it sent.
 * A hand settled at 3am is described in whatever language the player is reading
 * in now, and switching language re-labels the history rather than leaving a
 * mixed-language list.
 */

const ICONS: Record<NotificationKind, { icon: LucideIcon; tone: string }> = {
  RESULT: { icon: Trophy, tone: 'text-brand' },
  DEPOSIT: { icon: Wallet, tone: 'text-success' },
  // Money leaving, so not the same green as money arriving.
  WITHDRAWAL: { icon: ArrowUpRight, tone: 'text-accent' },
  PROMO: { icon: Megaphone, tone: 'text-accent' },
  JACKPOT: { icon: Crown, tone: 'text-jackpot' },
  SYSTEM: { icon: Info, tone: 'text-dim' },
};

/**
 * Format the params a notification carries for display.
 *
 * `amount` arrives as the ledger's six-decimal string ('500.000000'). The
 * templates place their own currency mark, so only the number is formatted
 * here — see amountOnly(). Every other param passes through untouched.
 */
function displayParams(
  params: Record<string, string | number> | undefined,
): Record<string, string | number> {
  if (!params) return {};
  const out: Record<string, string | number> = { ...params };
  if (typeof out.amount === 'string') out.amount = amountOnly(out.amount);
  return out;
}

export function Notifications() {
  const { t } = useTranslation();
  const signedIn = useSession((s) => s.status === 'authenticated');
  const navigate = useNavigate();

  const [tabId, setTabId] = useState<string>(MESSAGE_TABS[0].id);
  const tab = MESSAGE_TABS.find((x) => x.id === tabId) ?? MESSAGE_TABS[0];
  const list = useNotifications(tab.kinds);
  const markRead = useMarkNotificationsRead();

  const rows = list.data?.pages.flatMap((p) => p.notifications) ?? [];
  const unreadByKind = list.data?.pages[0]?.unreadByKind;

  /*
   * Mark read by id, not the whole account.
   *
   * This passed `undefined`, which marks EVERYTHING. With tabs that is wrong
   * twice over: it clears the badges for tabs the reader never opened, and
   * those badges are the only reason the strip is worth having. Only the
   * rows actually on screen in the open tab are cleared.
   */
  const unreadHere = rows.filter((n) => !n.read).map((n) => n.id);
  const unreadKey = unreadHere.join(',');
  useEffect(() => {
    if (signedIn && unreadKey.length > 0 && !markRead.isPending) {
      markRead.mutate(unreadKey.split(','));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, unreadKey]);

  if (!signedIn) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <EmptyState icon={Bell} title={t('notifications.signInToSee')} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/*
        The tab strip sits ABOVE the query's own states, never inside them.
        Rendered within the list it would vanish the moment you picked a tab
        that happened to be empty, leaving the reader on a blank screen with no
        way back to the other tabs — the affordance destroyed by the state it
        exists to escape.
      */}
      <div className="flex gap-1.5" role="tablist">
        {MESSAGE_TABS.map(({ id, kinds }) => {
          const active = id === tabId;
          const count = unreadByKind
            ? kinds.reduce((sum, k) => sum + (unreadByKind[k] ?? 0), 0)
            : 0;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTabId(id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-(--radius-app) border px-2 py-2 text-xs font-bold transition',
                active
                  ? 'border-brand/40 bg-brand/10 text-brand'
                  : 'border-border bg-surface text-dim hover:text-text',
              )}
            >
              {t(`notifications.tab.${id}`)}
              {count > 0 && (
                <span className="grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[0.55rem] font-bold text-white">
                  {count > 9 ? '9+' : count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {list.isPending && (
        <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="mt-1.5 h-2.5 w-20" />
              </div>
            </div>
          ))}
        </div>
      )}

      {list.isError && (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <ErrorState message={t(errorKey(list.error))} onRetry={() => void list.refetch()} />
        </div>
      )}

      {list.isSuccess && rows.length === 0 && (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <EmptyState
            icon={Bell}
            title={t('notifications.empty')}
            description={t('notifications.emptyBlurb')}
          />
        </div>
      )}

      {rows.length > 0 && (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
            {rows.map((n) => {
              const { icon: Icon, tone } = ICONS[n.kind] ?? ICONS.SYSTEM;
              // Money notifications open the transaction they are about. Ones
              // with no ledger row behind them (jackpot, system notices) stay
              // plain, rather than offering a tap that goes nowhere.
              const ref = txnRefFromEventId(n.id);
              const body = (
                <>
                  <div
                    className={cn(
                      'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface-2',
                      tone,
                    )}
                  >
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-sm', n.read ? 'text-dim' : 'font-semibold')}>
                      {/* defaultValue so an unknown key from a newer server
                          renders as something rather than the key itself. */}
                      {t(n.titleKey, { ...displayParams(n.params), defaultValue: n.titleKey })}
                    </div>
                    <div className="mt-0.5 text-[0.66rem] text-dim">
                      {new Date(n.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" />}
                </>
              );

              return (
                <li key={n.id}>
                  {ref ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/wallet?txn=${encodeURIComponent(ref)}`)}
                      className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2 active:bg-surface-2"
                    >
                      {body}
                      <ChevronRight size={16} className="mt-1.5 shrink-0 text-dim" />
                    </button>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>

          {list.hasNextPage && (
            <Button
              variant="ghost"
              className="w-full"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? t('common.loading') : t('data.loadMore')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
