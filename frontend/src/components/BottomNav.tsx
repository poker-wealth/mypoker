import { NavLink } from 'react-router-dom';
import { Home, Gamepad2, Wallet, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';

const tabs: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Lobby', icon: Home },
  { to: '/games', label: 'Games', icon: Gamepad2 },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
  { to: '/profile', label: 'Profile', icon: User },
];

export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[520px] border-t border-border bg-surface/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={() => haptic('light')}
          className="flex flex-1 flex-col items-center gap-0.5 py-2.5"
        >
          {({ isActive }) => (
            <>
              <Icon size={22} className={cn(isActive ? 'text-brand' : 'text-dim')} />
              <span className={cn('text-[0.66rem] font-semibold', isActive ? 'text-brand' : 'text-dim')}>
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
