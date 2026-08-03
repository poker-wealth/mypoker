import { ShieldCheck, History, Settings, LifeBuoy, Send } from 'lucide-react';
import { ListRow } from '@/components/ui/ListRow';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const STATS = [
  { label: 'Hands', value: '0' },
  { label: 'Win rate', value: '—' },
  { label: 'Biggest win', value: '₮0' },
];

export function Profile() {
  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="flex items-center gap-3 rounded-(--radius-app) border border-border bg-surface p-4">
        <div
          className="grid size-14 shrink-0 place-items-center rounded-full text-lg font-black text-white"
          style={{ backgroundImage: 'var(--brand-gradient)' }}
        >
          M
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Guest Player</div>
          <div className="text-xs text-dim">Not signed in</div>
        </div>
        <Badge tone="brand">VIP 0</Badge>
      </div>

      {/* Sign-in CTA */}
      <div className="rounded-(--radius-app) border border-brand/30 bg-brand/5 p-4">
        <div className="text-sm font-semibold">Sign in to save your progress</div>
        <div className="mt-1 text-xs text-dim">Connect Telegram to sync balance, history &amp; VIP rewards.</div>
        <Button full className="mt-3">
          <Send size={17} /> Continue with Telegram
        </Button>
      </div>

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
        <ListRow title="Fairness verification" leading={<ShieldCheck size={18} className="text-accent" />} onClick={() => {}} />
        <ListRow title="Game history" leading={<History size={18} className="text-dim" />} onClick={() => {}} />
        <ListRow title="Settings" leading={<Settings size={18} className="text-dim" />} onClick={() => {}} />
        <ListRow title="Support" leading={<LifeBuoy size={18} className="text-dim" />} onClick={() => {}} />
      </div>

      <div className="pt-1 text-center text-[0.66rem] text-dim">MYPOKER · staging build · v0.1</div>
    </div>
  );
}
