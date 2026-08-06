import { useState } from 'react';
import { ShieldCheck, Settings, LifeBuoy, Send, LogOut, ChevronRight, Eye, User as UserIcon, Star, Bell, Gift, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LanguageSheet } from '@/components/LanguageSheet';
import { useSession } from '@/store/session';
import { isTelegram } from '@/lib/telegram';
import { toast } from '@/store/toast';

export function Profile() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { player, status, signIn, signOut } = useSession();
  const signedIn = status === 'authenticated' && player !== null;
  const [languageOpen, setLanguageOpen] = useState(false);

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

        {/* Progress Bar */}
        <div className="mt-5 flex items-center gap-3">
          <div className="text-[0.65rem] font-black tracking-wide">Lv. {signedIn ? '28' : '0'}</div>
          <div className="h-2 flex-1 rounded-full bg-surface-2 overflow-hidden border border-border/50">
            <div className={`h-full bg-success rounded-full`} style={{ width: signedIn ? '68%' : '0%' }} />
          </div>
          <div className="text-[0.65rem] font-black text-dim tracking-wide">{signedIn ? '68%' : '0%'}</div>
        </div>
      </div>

      {/* Balance Card */}
      <div className="rounded-(--radius-app) bg-surface p-5 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-dim">
            Total Balance (USDT) <Eye size={14} className="cursor-pointer hover:text-text" />
          </div>
          <div className="flex items-center gap-0.5 text-[0.7rem] font-bold text-dim cursor-pointer hover:text-text transition-colors" onClick={() => navigate('/wallet')}>
            Detail <ChevronRight size={14} />
          </div>
        </div>
        <div className="mt-2 text-[1.7rem] font-black tabular-nums tracking-tight">
          0.00
        </div>
        <div className="mt-0.5 text-[0.7rem] font-semibold text-dim">
          ≈ $0.00
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button className="bg-success text-success-fg hover:bg-success/90" onClick={() => navigate('/wallet')}>
            DEPOSIT
          </Button>
          <Button variant="secondary" className="border-border bg-surface-2 hover:bg-surface-2/80" onClick={() => navigate('/wallet')}>
            WITHDRAW
          </Button>
        </div>
      </div>

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
          icon={Bell} 
          title="Message Center" 
          badge="12" 
          onClick={() => toast.info('You have 12 unread messages')}
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
