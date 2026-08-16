import { motion, useReducedMotion } from 'motion/react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, Banknote, Users, Shield, TriangleAlert, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The admin area's own shell (SAMUEL.md task 3).
 *
 * Separate from `AppShell` on purpose, and not because of styling. AppShell
 * carries `BottomNav`, and admin must never appear as a product tab — a player
 * should not learn the panel exists from their own navigation. It is reached
 * by URL, by people who were told the URL.
 *
 * Wider than the player shell's 520px: admin reads tables of numbers rather
 * than a phone-shaped feed, and the doc allows it.
 *
 * No guard here. The gate is server-side — every route under /admin answers
 * 404 to anyone who is not ops — and a client-side check would be decoration,
 * since the bundle ships to everyone regardless. What this shell does is
 * decide what to SHOW when those calls fail, which is a different job.
 */

const SECTIONS = [
  { to: '/admin', end: true, label: 'Overview', icon: LayoutGrid },
  { to: '/admin/withdrawals', label: 'Withdrawals', icon: Banknote },
  { to: '/admin/players', label: 'Players', icon: Users },
  { to: '/admin/leagues', label: 'Leagues', icon: Shield },
  { to: '/admin/alerts', label: 'Alerts', icon: TriangleAlert },
] as const;

export function AdminShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  return (
    <div className="mx-auto flex min-h-full max-w-[880px] flex-col px-4 pb-10">
      <header className="flex items-center gap-3 py-4">
        <button
          onClick={() => navigate('/')}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-dim active:bg-surface-2"
          aria-label="Back to the app"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-base font-bold">Admin</h1>
      </header>

      {/*
        The section bar. `Segmented` takes a value and an onChange, which would
        mean mirroring the router's state into component state and keeping the
        two in step; NavLink reads the URL directly, so the URL stays the single
        source of truth and a pasted link lands on the right tab.
      */}
      <nav
        className="flex gap-1 overflow-x-auto rounded-(--radius-app) border border-border bg-surface p-1"
        aria-label="Admin sections"
      >
        {SECTIONS.map(({ to, label, icon: Icon, ...rest }) => (
          <NavLink
            key={to}
            to={to}
            end={'end' in rest ? rest.end : false}
            className={({ isActive }) =>
              cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
                isActive ? 'bg-brand text-white' : 'text-dim active:bg-surface-2',
              )
            }
          >
            <Icon size={14} />
            {label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 pt-4">
        <motion.div
          key={location.pathname}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}
