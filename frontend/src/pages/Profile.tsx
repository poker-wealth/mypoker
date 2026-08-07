import { useState } from 'react';
import { ShieldCheck, History, Settings, LifeBuoy, Send, Wallet, LogOut, Languages, Spade, Bell, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ListRow } from '@/components/ui/ListRow';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LanguageSheet } from '@/components/LanguageSheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSession } from '@/store/session';
import { useStats, useReputation } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { moneyFromDecimal } from '@/lib/money';
import { isTelegram } from '@/lib/telegram';
import { LANGUAGES } from '@/i18n/languages';

export function Profile() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { player, status, error, signIn, signOut } = useSession();
  const signedIn = status === 'authenticated' && player !== null;
  const [languageOpen, setLanguageOpen] = useState(false);
  const stats = useStats();

  const currentLanguage =
    LANGUAGES.find((l) => l.code === i18n.resolvedLanguage)?.label ?? '';

  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="flex items-center gap-3 rounded-(--radius-app) border border-border bg-surface p-4">
        {signedIn && player.photoUrl ? (
          <img
            src={player.photoUrl}
            alt=""
            className="size-14 shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="grid size-14 shrink-0 place-items-center rounded-full text-lg font-black text-white"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          >
            {signedIn ? player.displayName.charAt(0).toUpperCase() : 'M'}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">
            {signedIn ? player.displayName : t('account.guest')}
          </div>
          <div className="truncate text-xs text-dim">
            {signedIn
              ? player.username
                ? `@${player.username}`
                : t('account.id', { id: player.playerId })
              : t('account.notSignedIn')}
          </div>
        </div>
        <button onClick={() => signedIn && navigate('/vip')} disabled={!signedIn}>
          <Badge tone="brand">{t('account.vip', { tier: signedIn ? player.vipTier : 0 })}</Badge>
        </button>
      </div>

      {/* Sign-in CTA — hidden once signed in */}
      {!signedIn && (
        <div className="rounded-(--radius-app) border border-brand/30 bg-brand/5 p-4">
          <div className="text-sm font-semibold">
            {status === 'anonymous'
              ? t('account.openInTelegramTitle')
              : t('account.signInTitle')}
          </div>
          <div className="mt-1 text-xs text-dim">
            {status === 'anonymous'
              ? t('account.openInTelegramBlurb')
              : t('account.signInBlurb')}
          </div>
          {status === 'error' && error && (
            <div className="mt-2 text-xs text-danger">{error}</div>
          )}
          {(isTelegram() || status === 'error') && (
            <Button full className="mt-3" onClick={() => void signIn()} disabled={status === 'authenticating'}>
              <Send size={17} />
              {status === 'authenticating'
                ? t('account.signingIn')
                : t('account.continueWithTelegram')}
            </Button>
          )}
        </div>
      )}

      {/* Stats — real, from the ledger. Signed out, this section is simply absent
          rather than showing zeros that would read as a real record of no wins. */}
      {signedIn && (
        <section>
          {stats.isPending && (
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="rounded-(--radius-app) border border-border bg-surface px-2 py-3"
                >
                  <Skeleton className="mx-auto h-6 w-14" />
                  <Skeleton className="mx-auto mt-2 h-2.5 w-10" />
                </div>
              ))}
            </div>
          )}

          {stats.isError && (
            <div className="rounded-(--radius-app) border border-border bg-surface">
              {/* Translated copy, not error.message — the raw text is a
                  diagnostic ("Expected JSON from /me/stats but got text/html")
                  that tells a player nothing except that something is broken in
                  a way that sounds like their fault. It goes to the console. */}
              <ErrorState message={t(errorKey(stats.error))} onRetry={() => void stats.refetch()} />
            </div>
          )}

          {/* A new player has real zeros, but three of them read as a record of
              losing rather than as never having played. Say which it is. */}
          {stats.isSuccess && stats.data.handsPlayed === 0 && (
            <div className="rounded-(--radius-app) border border-border bg-surface">
              <EmptyState
                icon={Spade}
                title={t('account.noHands')}
                description={t('account.noHandsBlurb')}
                action={{ label: t('nav.lobby'), onClick: () => navigate('/') }}
              />
            </div>
          )}

          {stats.isSuccess && stats.data.handsPlayed > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <StatTile label={t('account.statHands')} value={String(stats.data.handsPlayed)} />
              <StatTile
                label={t('account.statWinRate')}
                // Null, not 0, when nothing has been played — '0%' would read as
                // "you have lost every hand" rather than "you haven't played".
                value={stats.data.winRate === null ? '—' : `${stats.data.winRate}%`}
              />
              <StatTile
                label={t('account.statBiggestWin')}
                value={moneyFromDecimal(stats.data.biggestWin)}
              />
            </div>
          )}
        </section>
      )}

      {signedIn && <ReputationRow />}

      {/* Menu */}
      <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
        {/* Wallet is no longer a tab — this is its entry point. */}
        <ListRow title={t('account.wallet')} leading={<Wallet size={18} className="text-brand" />} onClick={() => navigate('/wallet')} />
        <ListRow
          title={t('account.fairness')}
          leading={<ShieldCheck size={18} className="text-accent" />}
          onClick={() => navigate('/fairness')}
        />
        <ListRow
          title={t('notifications.title')}
          leading={<Bell size={18} className="text-brand" />}
          onClick={() => navigate('/notifications')}
        />
        <ListRow
          title={t('agent.title')}
          leading={<TrendingUp size={18} className="text-success" />}
          onClick={() => navigate('/agent')}
        />
        <ListRow title={t('account.history')} leading={<History size={18} className="text-dim" />} onClick={() => navigate('/data')} />
        <ListRow
          title={t('account.language')}
          subtitle={currentLanguage}
          leading={<Languages size={18} className="text-dim" />}
          onClick={() => setLanguageOpen(true)}
        />
        <ListRow
          title={t('account.settings')}
          leading={<Settings size={18} className="text-dim" />}
          onClick={() => navigate('/settings')}
        />
        <ListRow title={t('account.support')} leading={<LifeBuoy size={18} className="text-dim" />} onClick={() => {}} />
        {signedIn && (
          <ListRow title={t('account.signOut')} leading={<LogOut size={18} className="text-dim" />} onClick={signOut} />
        )}
      </div>

      <div className="pt-1 text-center text-[0.66rem] text-dim">{t('account.buildLine')}</div>

      <LanguageSheet open={languageOpen} onClose={() => setLanguageOpen(false)} />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-(--radius-app) border border-border bg-surface px-2 py-3 text-center">
      <div className="text-lg font-black tabular-nums">{value}</div>
      <div className="mt-0.5 text-[0.66rem] text-dim">{label}</div>
    </div>
  );
}

/**
 * Reputation, on the profile.
 *
 * Deliberately free of any language implying consequence for funds. The spec's
 * wording is unusually direct — a reputation score affecting a withdrawal is a
 * critical failure — and copy is where that leaks first: "restricted", "limited",
 * "blocked", even a red warning icon next to a low score, all invite the player
 * to believe their money is at stake. So a low band is stated plainly and the
 * line underneath says what it actually governs, which is tables and chat.
 */
function ReputationRow() {
  const { t } = useTranslation();
  const rep = useReputation();

  if (rep.isPending) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface p-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-6 w-16" />
      </div>
    );
  }
  // Silent on failure. Reputation is context, not something the player came for,
  // and an error card here would loom larger than the feature it is reporting.
  if (!rep.isSuccess) return null;

  const { score, band, roundsToAdvance } = rep.data;
  const tone =
    band === 'EXCELLENT' || band === 'GOOD'
      ? 'text-success'
      : band === 'AVERAGE'
        ? 'text-text'
        : 'text-dim';

  return (
    <div className="rounded-(--radius-app) border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-dim">
          {t('reputation.title')}
        </span>
        <span className="text-[0.66rem] text-dim">{t(`reputation.band.${band}`)}</span>
      </div>
      <div className={`mt-1 text-2xl font-black tabular-nums ${tone}`}>{score}</div>

      {roundsToAdvance > 0 && (
        <div className="mt-2 text-[0.66rem] text-dim">
          {t('reputation.toAdvance', { count: roundsToAdvance })}
        </div>
      )}

      <p className="mt-2 text-[0.66rem] leading-relaxed text-dim">{t('reputation.scope')}</p>
    </div>
  );
}
