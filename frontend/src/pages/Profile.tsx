import { Settings, User, Crown, ShieldCheck, Users, MessageSquare, LifeBuoy, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ListRow } from '@/components/ui/ListRow';
import { Button } from '@/components/ui/Button';

export function Profile() {
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      {/* Header / Top */}
      <div className="flex items-start justify-between pb-1 pt-2">
        <div className="flex items-center gap-3">
          <div
            className="grid size-14 shrink-0 place-items-center rounded-full text-lg font-black text-white"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          >
            M
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold">MyPoker Player</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-0.5 text-[0.65rem] font-bold text-yellow-500">
                <Crown size={10} /> VIP 0
              </span>
              <span className="text-xs text-dim">ID: 123456789</span>
            </div>
          </div>
        </div>
        <button className="text-dim transition-colors hover:text-text">
          <Settings size={20} />
        </button>
      </div>

      {/* Level progress */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold">Lv. 28</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-[68%] rounded-full bg-success" />
        </div>
        <span className="text-xs font-bold text-dim">68%</span>
      </div>

      {/* Balance card */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-dim">Total Balance (USDT)</div>
          <button className="flex items-center gap-1 text-xs text-dim hover:text-text">
            Detail <ChevronRight size={14} />
          </button>
        </div>
        <div className="mt-1 text-[1.8rem] font-black tabular-nums tracking-tight text-text">
          12,345.67
        </div>
        <div className="mt-0.5 text-[0.7rem] font-medium text-dim">≈ $12,345.67</div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button className="bg-success text-success-fg hover:bg-success/90" onClick={() => navigate('/wallet')}>
            DEPOSIT
          </Button>
          <Button variant="secondary" className="border-border bg-surface text-dim" onClick={() => navigate('/wallet')}>
            WITHDRAW
          </Button>
        </div>
      </div>

      {/* Menu */}
      <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
        <ListRow title="Personal Info" leading={<User size={18} className="text-dim" />} onClick={() => {}} />
        <ListRow 
          title="VIP Membership" 
          leading={<Crown size={18} className="text-dim" />} 
          trailing={<span className="text-xs text-yellow-500">Check Privileges</span>}
          onClick={() => {}} 
        />
        <ListRow title="Security Center" leading={<ShieldCheck size={18} className="text-dim" />} onClick={() => {}} />
        <ListRow 
          title="Invite Friends" 
          leading={<Users size={18} className="text-dim" />} 
          trailing={<span className="text-xs text-success">Earn Rewards</span>}
          onClick={() => {}} 
        />
        <ListRow 
          title="Message Center" 
          leading={<MessageSquare size={18} className="text-dim" />} 
          trailing={
            <div className="flex size-5 items-center justify-center rounded-full bg-danger text-[0.65rem] font-bold text-white">
              12
            </div>
          }
          onClick={() => {}} 
        />
        <ListRow title="Customer Support" leading={<LifeBuoy size={18} className="text-dim" />} onClick={() => {}} />
        <ListRow title="Settings" leading={<Settings size={18} className="text-dim" />} onClick={() => {}} />
      </div>
    </div>
  );
}
