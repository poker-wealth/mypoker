import { useTranslation } from 'react-i18next';
import { Shield, X } from 'lucide-react';
import { useContextStore } from '@/store/context';
import { haptic } from '@/lib/telegram';

/**
 * "You are inside an alliance" — shown whenever the player is in a league
 * context, and never when they are not.
 *
 * The platform and league systems are absolutely isolated (iron rule 6): a
 * league's private rooms do not appear in the public lobby, and inside a league
 * you see that league's tables and wallet instead of the platform's. That is
 * the correct behaviour and it is also indistinguishable, from the player's
 * side, from tables having gone missing and their balance having changed.
 *
 * So the switch is never silent. The banner states which alliance is active and
 * offers one tap back out — an unexplained empty lobby is the failure mode this
 * exists to prevent.
 */
export function ContextBanner() {
  const { t } = useTranslation();
  const leagueId = useContextStore((s) => s.leagueId);
  const leagueName = useContextStore((s) => s.leagueName);
  const leave = useContextStore((s) => s.leavePlatformContext);

  if (!leagueId) return null;

  return (
    <div className="flex items-center gap-2 rounded-(--radius-app) border border-brand/40 bg-brand/10 px-3 py-2">
      <Shield size={15} className="shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold text-brand">
          {t('context.inLeague', { name: leagueName ?? leagueId })}
        </div>
        <div className="truncate text-[0.62rem] text-dim">{t('context.isolationNote')}</div>
      </div>
      <button
        onClick={() => {
          haptic('light');
          leave();
        }}
        className="shrink-0 rounded-lg p-1.5 text-dim active:bg-surface-2"
        aria-label={t('context.backToPlatform')}
      >
        <X size={15} />
      </button>
    </div>
  );
}
