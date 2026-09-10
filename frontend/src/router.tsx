import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Landing } from '@/pages/Landing';
// The styled admin dead-end (the "crash tab" fix) lives in route-fallbacks now; the withdrawals
// stub that file also carries is unused here — the real review queue landed with league-funding.
import { AdminRouteError } from '@/pages/admin/route-fallbacks';
import { isAdminHost } from '@/lib/adminHost';

// The panel's sections, mounted at whatever base the host uses (root on the admin
// subdomain, /admin on the player host — see below).
const adminChildren = [
  { index: true, lazy: async () => ({ Component: (await import('@/pages/admin/Overview')).AdminOverview }) },
  { path: 'withdrawals', lazy: async () => ({ Component: (await import('@/pages/admin/Withdrawals')).AdminWithdrawals }) },
  { path: 'users', lazy: async () => ({ Component: (await import('@/pages/admin/Players')).AdminPlayers }) },
  { path: 'leagues', lazy: async () => ({ Component: (await import('@/pages/admin/Leagues')).AdminLeagues }) },
  { path: 'alerts', lazy: async () => ({ Component: (await import('@/pages/admin/Alerts')).AdminAlerts }) },
  { path: 'admins', lazy: async () => ({ Component: (await import('@/pages/admin/Admins')).AdminAdmins }) },
];

/**
 * Two shapes, chosen by host:
 *
 *   admin.mypoker777.com → the panel IS the site. It lives at the ROOT (no
 *     /admin prefix, no redirect): `/` is Overview, `/withdrawals` etc. The
 *     player app is not reachable here, which is the point.
 *
 *   mypoker777.com → the player app at the root, with the admin panel nested
 *     under /admin (reached by URL, never linked from player navigation).
 *
 * AdminShell's own gate still decides who may see the panel on either host.
 */
export const router = isAdminHost()
  ? createBrowserRouter([
      {
        path: '/',
        lazy: async () => ({ Component: (await import('@/components/AdminShell')).AdminShell }),
        errorElement: <AdminRouteError />,
        children: adminChildren,
      },
    ])
  : createBrowserRouter([
      {
        path: '/',
        element: <AppShell />,
        children: [
          // Lobby is the landing route for Telegram and signed-in players.
          // A signed-out browser never reaches it: AppShell's gate sends a
          // stranger at the root to /download (the public landing) — ONE place
          // decides who sees what at the front door, and it is the shell.
          { index: true, lazy: async () => ({ Component: (await import('@/pages/Lobby')).Lobby }) },
          { path: 'alliance', lazy: async () => ({ Component: (await import('@/pages/Alliance')).Alliance }) },
          { path: 'games', lazy: async () => ({ Component: (await import('@/pages/Games')).Games }) },
          { path: 'data', lazy: async () => ({ Component: (await import('@/pages/Data')).Data }) },
          { path: 'profile', lazy: async () => ({ Component: (await import('@/pages/Profile')).Profile }) },
          // Not a tab — reached from My Account's deposit/withdraw.
          { path: 'wallet', lazy: async () => ({ Component: (await import('@/pages/Wallet')).Wallet }) },
          { path: 'settings', lazy: async () => ({ Component: (await import('@/pages/Settings')).Settings }) },
          // Not a tab — reached from Profile's "Personal Info" row.
          { path: 'personal', lazy: async () => ({ Component: (await import('@/pages/PersonalInfo')).PersonalInfo }) },
          // Browser sign-in (email/password + Google); inside Telegram the Mini App
          // signs in automatically and this screen is never routed to.
          { path: 'login', lazy: async () => ({ Component: (await import('@/pages/Login')).Login }) },
          { path: 'fairness', lazy: async () => ({ Component: (await import('@/pages/Fairness')).Fairness }) },
          { path: 'jackpot', lazy: async () => ({ Component: (await import('@/pages/Jackpot')).Jackpot }) },
          { path: 'vip', lazy: async () => ({ Component: (await import('@/pages/Vip')).Vip }) },
          { path: 'notifications', lazy: async () => ({ Component: (await import('@/pages/Notifications')).Notifications }) },
          { path: 'agent', lazy: async () => ({ Component: (await import('@/pages/AgentCenter')).AgentCenter }) },
        ],
      },
      // Admin. Its own shell, deliberately outside AppShell so it never appears in
      // BottomNav — a player should not learn the panel exists from their own nav.
      // The real gate is server-side: every /admin API answers 404 to non-ops.
      {
        path: '/admin',
        lazy: async () => ({ Component: (await import('@/components/AdminShell')).AdminShell }),
        errorElement: <AdminRouteError />,
        children: adminChildren,
      },
      { path: '/table/:id', lazy: async () => ({ Component: (await import('@/pages/Table')).Table }) },
      // The public landing/download page. Outside AppShell on purpose: it is
      // the marketing front door (navbar, hero, store buttons), not an app
      // tab, and it must render for people who have never signed in.
      //
      { path: '/download', element: <Landing /> },
    ]);
