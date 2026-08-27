import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutGrid,
  Banknote,
  Users,
  Shield,
  TriangleAlert,
  UserCog,
  Menu,
  X,
  LogOut,
  Loader2,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';
import { useSession } from '@/store/session';
import { AdminLogin } from '@/components/AdminLogin';

/**
 * The admin area's shell.
 *
 * Two jobs. First, the GATE: the panel renders only for an `ops` account —
 * anyone else (a player who found the URL, or nobody signed in) gets the admin
 * login, not the panel. This is UI only; every /admin API re-checks the token
 * server-side and 404s a non-ops caller, so a tampered client sees empty data,
 * not the platform.
 *
 * Second, the LAYOUT: a left sidebar (the doc's navigation), wider than the
 * player app because admin reads tables of numbers rather than a phone feed.
 * On a narrow screen the sidebar collapses into a drawer.
 *
 * Never in `AppShell` and never in the player BottomNav — a player should not
 * learn the panel exists from their own navigation.
 */

const SECTIONS = [
  { to: '/admin', end: true, label: 'Overview', icon: LayoutGrid },
  { to: '/admin/withdrawals', label: 'Withdrawals', icon: Banknote },
  { to: '/admin/players', label: 'Players', icon: Users },
  { to: '/admin/leagues', label: 'Leagues', icon: Shield },
  { to: '/admin/alerts', label: 'Alerts', icon: TriangleAlert },
  { to: '/admin/admins', label: 'Admins', icon: UserCog },
] as const;

export function AdminShell() {
  const { player, status, signOut } = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Still resolving a stored token — don't flash the login form at an admin who
  // is about to be recognised.
  if (status === 'authenticating') {
    return (
      <div className="grid min-h-screen place-items-center bg-bg text-dim">
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }

  // The gate. Absent role, or a player role, both fail closed.
  if (player?.role !== 'ops') {
    return <AdminLogin />;
  }

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Desktop sidebar — always present from md up. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <SidebarContent onNavigate={() => undefined} player={player} onSignOut={signOut} />
      </aside>

      {/* Mobile drawer. */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/55 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-surface md:hidden"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            >
              <SidebarContent
                onNavigate={() => setDrawerOpen(false)}
                player={player}
                onSignOut={signOut}
                closable
                onClose={() => setDrawerOpen(false)}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main column. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar with the menu toggle. */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            className="grid size-8 place-items-center rounded-lg text-dim active:bg-surface-2"
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <span className="text-sm font-bold">Admin</span>
        </header>

        <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6 md:px-8">
          <Content />
        </main>
      </div>
    </div>
  );
}

/** The routed section, with a light fade on navigation. */
function Content() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      key={location.pathname}
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
    >
      <Outlet />
    </motion.div>
  );
}

function SidebarContent({
  onNavigate,
  player,
  onSignOut,
  closable,
  onClose,
}: {
  onNavigate: () => void;
  player: { displayName: string };
  onSignOut: () => void;
  closable?: boolean;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black tracking-tight text-text">MYPOKER</span>
          <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-brand">
            Admin
          </span>
        </div>
        {closable && (
          <button
            onClick={onClose}
            className="grid size-7 place-items-center rounded-lg text-dim active:bg-surface-2"
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {SECTIONS.map(({ to, label, icon: Icon, ...rest }) => (
          <NavLink
            key={to}
            to={to}
            end={'end' in rest ? rest.end : false}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors',
                isActive ? 'bg-brand text-white' : 'text-dim hover:bg-surface-2 hover:text-text',
              )
            }
          >
            <Icon size={16} className="shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="px-2 pb-2">
          <div className="truncate text-xs font-semibold text-text">{player.displayName}</div>
          <div className="text-[0.6rem] text-dim">Signed in as administrator</div>
        </div>
        <button
          onClick={onSignOut}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-dim transition-colors hover:bg-surface-2 hover:text-danger"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </>
  );
}
