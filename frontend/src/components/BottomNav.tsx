import { NavLink } from 'react-router-dom';
import { Users, Gamepad2, Home, BarChart3, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';

/**
 * The five product tabs, in the owner-specified order. Wallet is deliberately not
 * here — it hangs off My Account (the deposit/withdraw entry point), matching the
 * reference design.
 */
const tabs: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/alliance', label: 'Alliance', icon: Users },
  { to: '/games', label: 'Games', icon: Gamepad2 },
  { to: '/', label: 'Lobby', icon: Home },
  { to: '/data', label: 'Stats', icon: BarChart3 },
  { to: '/profile', label: 'Me', icon: User },
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
          className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 py-2.5"
        >
          {({ isActive }) => (
            <>
              <Icon size={21} className={cn(isActive ? 'text-brand' : 'text-dim')} />
              <span
                className={cn(
                  'whitespace-nowrap text-[0.62rem] font-semibold',
                  isActive ? 'text-brand' : 'text-dim',
                )}
              >
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
