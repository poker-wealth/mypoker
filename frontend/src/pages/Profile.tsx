import { ShieldCheck, History, Settings, LifeBuoy, Send, Wallet, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ListRow } from '@/components/ui/ListRow';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/store/session';
import { isTelegram } from '@/lib/telegram';

const STATS = [
  { label: 'Hands', value: '0' },
  { label: 'Win rate', value: '—' },
  { label: 'Biggest win', value: '₮0' },
];

export function Profile() {
  const navigate = useNavigate();
  const { player, status, error, signIn, signOut } = useSession();
  const signedIn = status === 'authenticated' && player !== null;

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
            {signedIn ? player.displayName : 'Guest Player'}
          </div>
          <div className="truncate text-xs text-dim">
            {signedIn
              ? player.username
                ? `@${player.username}`
                : `ID: ${player.playerId}`
              : 'Not signed in'}
          </div>
        </div>
        <Badge tone="brand">VIP {signedIn ? player.vipTier : 0}</Badge>
      </div>

      {/* Sign-in CTA — hidden once signed in */}
      {!signedIn && (
        <div className="rounded-(--radius-app) border border-brand/30 bg-brand/5 p-4">
          <div className="text-sm font-semibold">
            {status === 'anonymous' ? 'Open in Telegram to sign in' : 'Sign in to save your progress'}
          </div>
          <div className="mt-1 text-xs text-dim">
            {status === 'anonymous'
              ? 'This app signs you in automatically when it runs inside Telegram.'
              : 'Connect Telegram to sync balance, history & VIP rewards.'}
          </div>
          {status === 'error' && error && (
            <div className="mt-2 text-xs text-danger">{error}</div>
          )}
          {(isTelegram() || status === 'error') && (
            <Button full className="mt-3" onClick={() => void signIn()} disabled={status === 'authenticating'}>
              <Send size={17} />
              {status === 'authenticating' ? 'Signing in…' : 'Continue with Telegram'}
            </Button>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-(--radius-app) border border-border bg-surface px-2 py-3 text-center">
            <div className="text-lg font-black tabular-nums">{s.value}</div>
            <div className="mt-0.5 text-[0.66rem] text-dim">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Menu */}
      <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
        {/* Wallet is no longer a tab — this is its entry point. */}
        <ListRow title="Wallet" leading={<Wallet size={18} className="text-brand" />} onClick={() => navigate('/Wallet')} />
        <ListRow title="Fairness verification" leading={<ShieldCheck size={18} className="text-accent" />} onClick={() => {}} />
        <ListRow title="Game history" leading={<History size={18} className="text-dim" />} onClick={() => {}} />
        <ListRow title="Settings" leading={<Settings size={18} className="text-dim" />} onClick={() => {}} />
        <ListRow title="Support" leading={<LifeBuoy size={18} className="text-dim" />} onClick={() => {}} />
        {signedIn && (
          <ListRow title="Sign out" leading={<LogOut size={18} className="text-dim" />} onClick={signOut} />
        )}
      </div>

      <div className="pt-1 text-center text-[0.66rem] text-dim">MYPOKER · staging build · v0.1</div>
    </div>
  );
}
