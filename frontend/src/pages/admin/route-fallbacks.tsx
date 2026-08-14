import { ClipboardList } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';

/**
 * The two dead-ends an admin URL can reach, styled so neither is ever React
 * Router's raw crash page.
 *
 * Deliberately NOT pages/admin/Withdrawals.tsx: the real review queue ships on
 * the league-funding branch under exactly that path, and a stub file there
 * would turn a one-line route conflict into a whole-file one when it lands.
 * This file holds only fallbacks; the league branch never touches it.
 */

/** The Withdrawals tab until the league-funding branch lands the real queue. */
export function AdminWithdrawalsPending() {
  return (
    <EmptyState
      icon={ClipboardList}
      title="Review queue not deployed yet"
      description="The withdrawal queue ships with the league-funding changes. Until they land, approvals happen through the internal API."
    />
  );
}

/** errorElement for /admin — a styled dead-end instead of a stack trace. */
export function AdminRouteError() {
  return <ErrorState message="This admin page does not exist." />;
}
