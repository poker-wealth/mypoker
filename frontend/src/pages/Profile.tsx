import { useState } from 'react';
import { Settings, ChevronRight, Eye, EyeOff, User as UserIcon, Star, ShieldCheck, Gift, Bell, LifeBuoy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/store/session';
import { useBalance, useStats } from '@/api/hooks';
import { isTelegram } from '@/lib/telegram';
import { useGoogleLogin } from '@react-oauth/google';
import { toast } from '@/store/toast';
import { Send, LogOut } from 'lucide-react';

export function Profile() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { player, status, signIn, signInWithGoogle, signOut } = useSession();
  const signedIn = status === 'authenticated' && player !== null;
  const [showBalance, setShowBalance] = useState(true);

  const googleLogin = useGoogleLogin({
    onSuccess: async (credentialResponse) => {
      try {
        if (credentialResponse.access_token) {
          await signInWithGoogle(credentialResponse.access_token);
        }
      } catch {
        toast.error('Google login failed');
      }
    },
  });
  
  const { data: balanceData } = useBalance();
  const stats = useStats('all');

  // Calculate level based on hands played (e.g. 1 level per 100 hands)
  const handsPlayed = stats.data?.handsPlayed ?? 0;
  const level = Math.max(1, Math.floor(handsPlayed / 100) + 1);
  const levelProgress = handsPlayed % 100;
  
  const balance = balanceData ? Number(balanceData.available) : 0;

  return (
    <div className="space-y-4">
      {/* Top Section */}
      <div className="relative rounded-2xl bg-surface p-5 border border-border">
        {/* Identity */}
        <div className="flex items-center gap-4">
          {signedIn && player.photoUrl ? (
            <img
              src={player.photoUrl}
              alt=""
              className="size-16 shrink-0 rounded-full object-cover border-2 border-border"
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
                {signedIn ? player.displayName : ''}
              </div>
              <ChevronRight size={20} className="text-dim" />
            </div>
            
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-0.5 text-[0.65rem] font-bold text-yellow-500">
                <Star size={10} className="fill-yellow-500" /> VIP {signedIn ? player.vipTier : 0}
              </div>
              <div className="flex items-center gap-1 rounded-full bg-brand/20 px-2 py-0.5 text-[0.65rem] font-bold text-brand">
                Lv. {level}
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

        {/* Level Progress */}
        <div className="mt-5 flex items-center gap-3">
          <span className="text-xs font-semibold text-dim">Lv. {level}</span>
          <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div 
              className="h-full bg-success rounded-full" 
              style={{ width: `${levelProgress}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-dim">{levelProgress}%</span>
        </div>
      </div>

      {/* Balance Section */}
      <div className="rounded-2xl bg-surface p-5 border border-border">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-dim flex items-center gap-2">
            Total Balance (USDT)
            <button onClick={() => setShowBalance(!showBalance)} className="text-dim hover:text-text">
              {showBalance ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          </div>
          <button 
            onClick={() => navigate('/wallet')} 
            className="text-xs font-semibold text-dim flex items-center gap-0.5"
          >
            Detail <ChevronRight size={14} />
          </button>
        </div>

        <div className="mt-2">
          <div className="text-3xl font-black tabular-nums tracking-tight">
            {showBalance ? balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '******'}
          </div>
          <div className="text-[0.75rem] font-semibold text-dim mt-0.5">
            {showBalance ? `≈ $${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '******'}
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <Button 
            full 
            className="flex-1 bg-success hover:bg-success/90 text-white font-bold border-none"
            onClick={() => navigate('/wallet')}
          >
            DEPOSIT
          </Button>
          <Button 
            full 
            variant="secondary" 
            className="flex-1 font-bold"
            onClick={() => navigate('/wallet')}
          >
            WITHDRAW
          </Button>
        </div>
      </div>

      {/* Sign-in CTA */}
      {!signedIn && (
        <div className="rounded-2xl border border-brand/30 bg-brand/5 p-4">
          <div className="text-sm font-semibold">{t('account.signInTitle')}</div>
          {(isTelegram() || import.meta.env.VITE_DEV_AUTH_BYPASS === 'true') && (
            <Button full className="mt-3" onClick={() => void signIn()} disabled={status === 'authenticating'}>
              <Send size={17} />
              {status === 'authenticating'
                ? t('account.signingIn')
                : import.meta.env.VITE_DEV_AUTH_BYPASS === 'true'
                  ? 'Sign in as Dev Player'
                  : t('account.continueWithTelegram')}
            </Button>
          )}
          {!isTelegram() && import.meta.env.VITE_DEV_AUTH_BYPASS !== 'true' && (
            <>
              <p className="mt-1 text-xs text-dim">{t('account.signInBlurbGoogle')}</p>
              <button
                onClick={() => googleLogin()}
                disabled={status === 'authenticating'}
                className="mt-3 flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-white px-4 text-sm font-bold text-black transition-colors hover:bg-gray-100 active:scale-[0.98] disabled:opacity-60"
              >
                <svg className="size-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.16v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.16C1.43 8.55 1 10.22 1 12s.43 3.45 1.16 4.93l3.68-2.84z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.16 7.07l3.68 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                {status === 'authenticating' ? t('account.signingIn') : 'Continue with Google'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Menu List */}
      <div className="divide-y divide-border/50 overflow-hidden rounded-2xl bg-surface border border-border">
        <MenuRow icon={UserIcon} title="Personal Info" />
        <MenuRow 
          icon={Star} 
          title="VIP Membership" 
          rightText="Check Privileges" 
          rightTextColor="text-yellow-500" 
        />
        <MenuRow icon={ShieldCheck} title="Security Center" />
        <MenuRow 
          icon={Gift} 
          title="Invite Friends" 
          rightText="Earn Rewards" 
          rightTextColor="text-success" 
        />
        <MenuRow 
          icon={Bell} 
          title="Message Center" 
          badge="12"
        />
        <MenuRow icon={LifeBuoy} title="Customer Support" />
        <MenuRow icon={Settings} title="Settings" onClick={() => navigate('/settings')} />
        
        {signedIn && (
          <MenuRow icon={LogOut} title={t('account.signOut')} onClick={signOut} />
        )}
      </div>

      <div className="pt-1 pb-4 text-center text-[0.66rem] text-dim">{t('account.buildLine')}</div>
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
      className="flex items-center justify-between px-4 py-4 cursor-pointer active:bg-surface-2 transition-colors hover:bg-surface-2/50"
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <Icon size={18} className="text-dim" />
        <span className="text-[0.85rem] font-semibold">{title}</span>
      </div>
      <div className="flex items-center gap-2">
        {rightText && (
          <span className={`text-[0.7rem] font-bold ${rightTextColor}`}>{rightText}</span>
        )}
        {badge && (
          <div className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-danger px-1.5 text-[0.65rem] font-bold text-white shadow-sm">
            {badge}
          </div>
        )}
        <ChevronRight size={16} className="text-dim opacity-70" />
      </div>
    </div>
  );
}
