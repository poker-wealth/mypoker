import { useState } from 'react';
import { ShieldCheck, Settings, LifeBuoy, Send, LogOut, ChevronRight, User as UserIcon, Star, Bell, Gift, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LanguageSheet } from '@/components/LanguageSheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useSession } from '@/store/session';
import { isTelegram } from '@/lib/telegram';
import { toast } from '@/store/toast';
import { useStats } from '@/api/hooks';
import { errorKey } from '@/api/errors';

/** Trim financial-core's six-decimal strings, keeping the sign. */
function money(value: string, signed = false): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}₮${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function Profile() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { player, status, signIn, signOut } = useSession();
  const signedIn = status === 'authenticated' && player !== null;
  const [languageOpen, setLanguageOpen] = useState(false);
  const stats = useStats('all');

  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="rounded-(--radius-app) bg-surface p-4 border border-border">
        <div className="flex items-center gap-3">
          {signedIn && player.photoUrl ? (
            <img
              src={player.photoUrl}
              alt=""
              className="size-16 shrink-0 rounded-full object-cover border-2 border-brand"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              className="grid size-16 shrink-0 place-items-center rounded-full text-2xl font-black text-white"
              style={{ backgroundImage: 'var(--brand-gradient)' }}
            >
              {signedIn ? player.displayName.charAt(0).toUpperCase() : 'M'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <div className="truncate text-lg font-bold">
                {signedIn ? player.displayName : t('account.guest')}
              </div>
              <ChevronRight size={20} className="text-dim" />
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-0.5 text-[0.65rem] font-bold text-yellow-500">
                <Star size={10} className="fill-yellow-500" /> VIP {signedIn ? player.vipTier : 0}
              </div>
            </div>
            <div className="mt-1.5 truncate text-[0.7rem] font-semibold text-dim">
              {signedIn
                ? player.username
                  ? `@${player.username}`
                  : `ID: ${player.playerId}`
                : t('account.notSignedIn')}
            </div>
          </div>
        </div>
      </div>



      {/* Stats Block - Only visible when signed in */}
      {signedIn && (
        <section>
          {stats.isPending && (
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-(--radius-app) border border-border bg-surface px-3 py-3">
                  <Skeleton className="mx-auto h-6 w-14" />
                  <Skeleton className="mx-auto mt-2 h-2.5 w-10" />
                </div>
              ))}
            </div>
          )}

          {stats.isError && (
            <div className="rounded-(--radius-app) border border-border bg-surface">
              <ErrorState message={t(errorKey(stats.error))} onRetry={() => void stats.refetch()} />
            </div>
          )}

          {stats.isSuccess && (
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-(--radius-app) border border-border bg-surface px-3 py-3">
                <div className="text-base font-black tabular-nums">{stats.data.handsPlayed}</div>
                <div className="mt-0.5 text-[0.66rem] text-dim">{t('account.statHands')}</div>
              </div>
              <div className="rounded-(--radius-app) border border-border bg-surface px-3 py-3">
                <div className="text-base font-black tabular-nums">{stats.data.winRate === null ? '—' : `${stats.data.winRate}%`}</div>
                <div className="mt-0.5 text-[0.66rem] text-dim">{t('account.statWinRate')}</div>
              </div>
              <div className="rounded-(--radius-app) border border-border bg-surface px-3 py-3">
                <div className="text-base font-black tabular-nums text-jackpot">{money(stats.data.biggestWin)}</div>
                <div className="mt-0.5 text-[0.66rem] text-dim">{t('account.statBiggestWin')}</div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Sign-in CTA — hidden once signed in */}
      {!signedIn && (
        <div className="rounded-(--radius-app) border border-brand/30 bg-brand/5 p-4">
          <div className="text-sm font-semibold">
            {status === 'anonymous'
              ? t('account.openInTelegramTitle')
              : t('account.signInTitle')}
          </div>
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

      {/* Menu List */}
      <div className="divide-y divide-border/50 overflow-hidden rounded-(--radius-app) bg-surface border border-border">
        <MenuRow icon={UserIcon} title="Personal Info" onClick={() => toast.info('Personal Info settings coming soon')} />
        <MenuRow 
          icon={Star} 
          title="VIP Membership" 
          rightText="Check Privileges" 
          rightTextColor="text-yellow-500" 
          onClick={() => toast.info('VIP Privileges coming soon')}
        />
        <MenuRow icon={ShieldCheck} title="Security Center" onClick={() => toast.info('Security Center coming soon')} />
        <MenuRow 
          icon={Gift} 
          title="Invite Friends" 
          rightText="Earn Rewards" 
          rightTextColor="text-success" 
          onClick={() => {
            void navigator.clipboard.writeText('MYPOKER-INVITE');
            toast.success('Invite code copied to clipboard!');
          }}
        />
        <MenuRow 
          icon={Wallet} 
          title="Wallet" 
          rightText="Manage Funds" 
          onClick={() => navigate('/wallet')}
        />
        <MenuRow 
          icon={Bell} 
          title="Message Center" 
          onClick={() => toast.info('Message Center coming soon')}
        />
        <MenuRow icon={LifeBuoy} title="Customer Support" onClick={() => toast.info('Connecting to Customer Support...')} />
        <MenuRow icon={Settings} title="Settings" onClick={() => navigate('/settings')} />
        
        {signedIn && (
          <MenuRow icon={LogOut} title={t('account.signOut')} onClick={signOut} />
        )}
      </div>

      <div className="pt-1 pb-4 text-center text-[0.66rem] text-dim">{t('account.buildLine')}</div>

      <LanguageSheet open={languageOpen} onClose={() => setLanguageOpen(false)} />
    </div>
  );
}

function MenuRow({ 
  icon: Icon, 
  title, 
  rightText, 
  rightTextColor, 
  badge, 
  onClick 
}: { 
  icon: any; 
  title: string; 
  rightText?: string; 
  rightTextColor?: string; 
  badge?: string; 
  onClick?: () => void;
}) {
  return (
    <div 
      className="flex items-center justify-between px-4 py-3.5 cursor-pointer active:bg-surface-2 transition-colors hover:bg-surface-2/50"
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <Icon size={18} className="text-dim" />
        <span className="text-[0.8rem] font-semibold">{title}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {rightText && (
          <span className={`text-[0.65rem] font-bold ${rightTextColor}`}>{rightText}</span>
        )}
        {badge && (
          <div className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[0.65rem] font-bold text-white shadow-sm">
            {badge}
          </div>
        )}
        <ChevronRight size={14} className="text-dim opacity-70" />
      </div>
    </div>
  );
}
