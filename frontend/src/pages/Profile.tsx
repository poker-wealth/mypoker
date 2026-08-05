import { useState } from 'react';
import { ShieldCheck, History, Settings, LifeBuoy, Send, Wallet, LogOut, Languages } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ListRow } from '@/components/ui/ListRow';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LanguageSheet } from '@/components/LanguageSheet';
import { useSession } from '@/store/session';
import { isTelegram } from '@/lib/telegram';
import { LANGUAGES } from '@/i18n/languages';

const STATS = [
  { key: 'account.statHands', value: '0' },
  { key: 'account.statWinRate', value: '—' },
  { key: 'account.statBiggestWin', value: '₮0' },
];

export function Profile() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { player, status, error, signIn, signOut } = useSession();
  const signedIn = status === 'authenticated' && player !== null;
  const [languageOpen, setLanguageOpen] = useState(false);

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
        <Badge tone="brand">{t('account.vip', { tier: signedIn ? player.vipTier : 0 })}</Badge>
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

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {STATS.map((s) => (
          <div key={s.key} className="rounded-(--radius-app) border border-border bg-surface px-2 py-3 text-center">
            <div className="text-lg font-black tabular-nums">{s.value}</div>
            <div className="mt-0.5 text-[0.66rem] text-dim">{t(s.key)}</div>
          </div>
        ))}
      </div>

      {/* Menu */}
      <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
        {/* Wallet is no longer a tab — this is its entry point. */}
        <ListRow title={t('account.wallet')} leading={<Wallet size={18} className="text-brand" />} onClick={() => navigate('/wallet')} />
        <ListRow title={t('account.fairness')} leading={<ShieldCheck size={18} className="text-accent" />} onClick={() => {}} />
        <ListRow title={t('account.history')} leading={<History size={18} className="text-dim" />} onClick={() => {}} />
        <ListRow
          title={t('account.language')}
          subtitle={currentLanguage}
          leading={<Languages size={18} className="text-dim" />}
          onClick={() => setLanguageOpen(true)}
        />
        <ListRow title={t('account.settings')} leading={<Settings size={18} className="text-dim" />} onClick={() => {}} />
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
