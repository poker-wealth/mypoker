import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Settings as SettingsIcon,
  ChevronRight,
  Eye,
  EyeOff,
  User,
  Crown,
  ShieldCheck,
  UserPlus,
  Bell,
  LifeBuoy,
  SlidersHorizontal,
  LogOut,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { LanguageSheet } from '@/components/LanguageSheet';
import { GoogleAuthButton } from '@/components/GoogleAuthButton';
import { useSession } from '@/store/session';
import { useBalance, useVip, useUnreadCount } from '@/api/hooks';
import { moneyFromDecimal } from '@/lib/money';
import { isTelegram, haptic } from '@/lib/telegram';
import { SUPPORT_URL } from '@/config';
import { toast } from '@/store/toast';
import { cn } from '@/lib/cn';

/**
 * Me — the account hub, built to the owner's mockup.
 *
 * Every figure on this screen is read from the server. The mockup carries
 * placeholder values (a 12,345.67 balance, "Lv. 28", a 68% bar, 12 unread) and
 * none of them are reproduced: a design document's numbers rendered as a
 * player's balance is the same failure as the fabricated VPIP/PFR stats the
 * Data tab had, and it is worse here because this screen is about money.
 *
 * Two places where the mockup asks for something that does not exist:
 *
 *   "Lv. 28" — there is no player level or XP system in any spec document; the
 *   only progression the platform actually has is the VIP ladder, which is
 *   earned by effective volume. So the bar is kept and bound to real VIP
 *   progress, and it is labelled with the tier it is really showing rather than
 *   a level nobody computes.
 *
 *   "≈ $12,345.67" under a USDT balance implies a conversion. Balances are
 *   USD-denominated micro-units already, so a second line repeating the same
 *   number in another currency would be theatre. That line shows the
 *   available / in-play split instead, which is real and worth knowing before
 *   you try to withdraw.
 */
export function Profile() {
  const { t } = useTranslation();
  const { player, status, error, signIn, signOut } = useSession();
  const signedIn = status === 'authenticated' && player !== null;
  const [languageOpen, setLanguageOpen] = useState(false);

  return (
    <div className="space-y-4 pb-2">
      <Identity signedIn={signedIn} />

      {signedIn && <BalanceCard />}

      {!signedIn && (
        <div className="space-y-3 rounded-(--radius-app) border border-brand/30 bg-brand/5 p-4">
          <div>
            <div className="text-sm font-semibold">{t('account.signInTitle')}</div>
            <div className="mt-1 text-xs leading-relaxed text-dim">
              {t('account.signInBlurb')}
            </div>
          </div>
          {status === 'error' && error && <div className="text-xs text-danger">{error}</div>}
          {isTelegram() ? (
            <Button full onClick={() => void signIn()} disabled={status === 'authenticating'}>
              <Send size={17} />
              {status === 'authenticating'
                ? t('account.signingIn')
                : t('account.continueWithTelegram')}
            </Button>
          ) : (
            <GoogleAuthButton />
          )}
        </div>
      )}

      <Menu
        signedIn={signedIn}
        onLanguage={() => setLanguageOpen(true)}
        onSignOut={signOut}
      />

      <div className="pt-1 text-center text-[0.66rem] text-dim">{t('account.buildLine')}</div>

      <LanguageSheet open={languageOpen} onClose={() => setLanguageOpen(false)} />
    </div>
  );
}

// ── Identity ─────────────────────────────────────────────────────────────────

function Identity({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const player = useSession((s) => s.player);
  const vip = useVip();

  return (
    <section>
      <div className="px-1 pb-3">
        <span className="text-sm font-bold">{t('nav.account')}</span>
      </div>

      <button
        onClick={() => signedIn && navigate('/settings')}
        disabled={!signedIn}
        className="flex w-full items-center gap-3 text-left"
      >
        {signedIn && player?.photoUrl ? (
          <img
            src={player.photoUrl}
            alt=""
            className="size-16 shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="grid size-16 shrink-0 place-items-center rounded-full text-xl font-black text-white"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          >
            {signedIn && player ? player.displayName.charAt(0).toUpperCase() : 'M'}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold">
            {signedIn && player ? player.displayName : t('account.guest')}
          </div>

          <div className="mt-1 flex items-center gap-1.5">
            {signedIn && vip.isSuccess && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-black text-white"
                style={{ backgroundImage: 'var(--brand-gradient)' }}
              >
                <Crown size={9} />
                {vip.data.tier}
              </span>
            )}
            <span className="truncate text-[0.66rem] text-dim">
              {signedIn && player
                ? t('account.id', { id: player.playerId })
                : t('account.notSignedIn')}
            </span>
          </div>
        </div>

        {signedIn && <ChevronRight size={18} className="shrink-0 text-dim" />}
      </button>

      {signedIn && <VipProgress />}
    </section>
  );
}

/**
 * The mockup's level bar, bound to the progression that actually exists.
 *
 * Shows the current VIP tier and how far through it the player is by effective
 * volume — the same figures the VIP page derives, from the same endpoint, so
 * the two screens can never disagree.
 */
function VipProgress() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const vip = useVip();

  if (vip.isPending) return <Skeleton className="mt-3 h-8 w-full rounded-lg" />;
  if (!vip.isSuccess) return null;

  const { title, progressPct, next } = vip.data;

  return (
    <button onClick={() => navigate('/vip')} className="mt-3 block w-full text-left">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-bold">{title}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${next ? progressPct : 100}%`,
              backgroundImage: 'var(--brand-gradient)',
            }}
          />
        </div>
        {/* At the top tier there is no "next", so a percentage would be
            meaningless — say so instead of showing 100%. */}
        <span className="shrink-0 text-[0.66rem] tabular-nums text-dim">
          {next ? `${progressPct}%` : t('vip.topTier')}
        </span>
      </div>
    </button>
  );
}

// ── Balance ──────────────────────────────────────────────────────────────────

function BalanceCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const balance = useBalance();
  // Hiding is per-session and deliberately not persisted: it protects against
  // someone glancing over a shoulder now, not against the device itself.
  const [hidden, setHidden] = useState(false);

  const masked = '••••••';

  return (
    <section className="rounded-(--radius-app) border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-dim">
          {t('wallet.totalBalance')}
        </span>
        <button
          onClick={() => {
            haptic('light');
            setHidden((v) => !v);
          }}
          className="rounded-lg p-1 text-dim active:bg-surface-2"
          aria-label={hidden ? t('wallet.showBalance') : t('wallet.hideBalance')}
        >
          {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-3">
        {balance.isPending ? (
          <Skeleton className="h-9 w-40" />
        ) : balance.isSuccess ? (
          <span className="truncate text-3xl font-black tabular-nums">
            {hidden ? masked : moneyFromDecimal(balance.data.total, { decimals: 2 })}
          </span>
        ) : (
          // Never a zero on failure: "0.00" is a balance, and telling someone
          // their money is gone because a request failed is unforgivable here.
          <span className="text-3xl font-black text-dim">—</span>
        )}

        <button
          onClick={() => navigate('/wallet')}
          className="flex shrink-0 items-center gap-0.5 text-[0.7rem] font-semibold text-dim"
        >
          {t('wallet.detail')}
          <ChevronRight size={13} />
        </button>
      </div>

      {/* The split, not a currency conversion — see the note at the top. */}
      {balance.isSuccess && !hidden && (
        <div className="mt-0.5 text-[0.66rem] tabular-nums text-dim">
          {t('wallet.availableSplit', {
            available: moneyFromDecimal(balance.data.available, { decimals: 2 }),
            locked: moneyFromDecimal(balance.data.locked, { decimals: 2 }),
          })}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Button
          className="bg-success text-success-fg hover:bg-success/90"
          onClick={() => navigate('/wallet?action=deposit')}
        >
          {t('wallet.deposit')}
        </Button>
        <Button variant="secondary" onClick={() => navigate('/wallet?action=withdraw')}>
          {t('wallet.withdraw')}
        </Button>
      </div>
    </section>
  );
}

// ── Menu ─────────────────────────────────────────────────────────────────────

function Menu({
  signedIn,
  onLanguage,
  onSignOut,
}: {
  signedIn: boolean;
  onLanguage: () => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const unread = useUnreadCount();

  return (
    <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
      <Row
        icon={<User size={17} className="text-dim" />}
        title={t('account.personalInfo')}
        onClick={() => navigate('/personal')}
      />
      <Row
        icon={<Crown size={17} className="text-jackpot" />}
        title={t('account.vipMembership')}
        hint={t('account.checkPrivileges')}
        hintTone="jackpot"
        onClick={() => navigate('/vip')}
      />
      {/* Provably-fair verification is not on the mockup, but it is the
          platform's headline promise and a spec'd screen — burying it behind
          Settings would make "Fair. On-Chain. Always." something a player
          cannot actually check. */}
      <Row
        icon={<ShieldCheck size={17} className="text-accent" />}
        title={t('account.fairness')}
        onClick={() => navigate('/fairness')}
      />
      <Row
        icon={<UserPlus size={17} className="text-dim" />}
        title={t('account.inviteFriends')}
        hint={t('account.earnRewards')}
        hintTone="success"
        onClick={() => navigate('/agent')}
      />
      <Row
        icon={<Bell size={17} className="text-brand" />}
        title={t('account.messageCenter')}
        // Absent at zero rather than a "0" chip — a badge means "something is
        // waiting for you", and one that is always there stops meaning it.
        badge={unread.isSuccess && unread.data > 0 ? unread.data : undefined}
        onClick={() => navigate('/notifications')}
      />
      <Row
        icon={<LifeBuoy size={17} className="text-dim" />}
        title={t('account.support')}
        onClick={() => {
          // The toast branch matters: with SUPPORT_URL unset (no VITE_SUPPORT_URL,
          // no bot name) a bare `if` made this a silent no-op — the exact dead
          // control this task existed to remove, back under default config.
          // Settings has always had the toast; Profile now matches it.
          if (SUPPORT_URL) {
            window.open(SUPPORT_URL, '_blank', 'noopener');
          } else {
            toast.info(t('account.supportConnecting', { defaultValue: 'Connecting to support...' }));
          }
        }}
      />
      <Row
        icon={<SlidersHorizontal size={17} className="text-dim" />}
        title={t('account.settings')}
        onClick={() => navigate('/settings')}
      />
      <Row
        icon={<SettingsIcon size={17} className="text-dim" />}
        title={t('account.language')}
        onClick={onLanguage}
      />
      {signedIn && (
        <Row
          icon={<LogOut size={17} className="text-dim" />}
          title={t('account.signOut')}
          onClick={onSignOut}
        />
      )}
    </div>
  );
}

function Row({
  icon,
  title,
  hint,
  hintTone,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  hintTone?: 'jackpot' | 'success';
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={() => {
        haptic('light');
        onClick();
      }}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-surface-2"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{title}</span>

      {hint && (
        <span
          className={cn(
            'shrink-0 text-[0.7rem] font-semibold',
            hintTone === 'success' ? 'text-success' : 'text-jackpot',
          )}
        >
          {hint}
        </span>
      )}

      {badge !== undefined && (
        <span className="grid min-w-[1.15rem] shrink-0 place-items-center rounded-full bg-danger px-1 text-[0.6rem] font-black text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}

      <ChevronRight size={16} className="shrink-0 text-dim" />
    </button>
  );
}
