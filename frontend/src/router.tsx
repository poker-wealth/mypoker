import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Alliance } from '@/pages/Alliance';
import { Lobby } from '@/pages/Lobby';
import { Games } from '@/pages/Games';
import { Data } from '@/pages/Data';
import { Wallet } from '@/pages/Wallet';
import { Profile } from '@/pages/Profile';
import { PersonalInfo } from '@/pages/PersonalInfo';
import { Settings } from '@/pages/Settings';
import { Fairness } from '@/pages/Fairness';
import { Jackpot } from '@/pages/Jackpot';
import { Vip } from '@/pages/Vip';
import { Notifications } from '@/pages/Notifications';
import { AgentCenter } from '@/pages/AgentCenter';
import { Table } from '@/pages/Table';
import { Login } from '@/pages/Login';
import { AdminShell } from '@/components/AdminShell';
import { AdminOverview } from '@/pages/admin/Overview';
import { AdminPlayers } from '@/pages/admin/Players';
import { AdminAlerts } from '@/pages/admin/Alerts';
import { AdminLeagues } from '@/pages/admin/Leagues';
import { AdminWithdrawals } from '@/pages/admin/Withdrawals';
// The styled admin dead-end (the "crash tab" fix) lives in route-fallbacks now; the withdrawals
// stub that file also carries is unused here — the real review queue landed with league-funding.
import { AdminRouteError } from '@/pages/admin/route-fallbacks';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      // Lobby stays the landing route; Alliance is tab 1 but not the entry screen.
      { index: true, element: <Lobby /> },
      { path: 'alliance', element: <Alliance /> },
      { path: 'games', element: <Games /> },
      { path: 'data', element: <Data /> },
      { path: 'profile', element: <Profile /> },
      // Not a tab — reached from My Account's deposit/withdraw.
      { path: 'wallet', element: <Wallet /> },
      { path: 'settings', element: <Settings /> },
      // Not a tab — reached from Profile's "Personal Info" row.
      { path: 'personal', element: <PersonalInfo /> },
      // Browser sign-in (email/password + Google); inside Telegram the Mini App
      // signs in automatically and this screen is never routed to.
      { path: 'login', element: <Login /> },
      { path: 'fairness', element: <Fairness /> },
      { path: 'jackpot', element: <Jackpot /> },
      { path: 'vip', element: <Vip /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'agent', element: <AgentCenter /> },
    ],
  },
  // Full-screen game table (no bottom nav / shell chrome).
  // Admin. Its own shell, deliberately outside AppShell so it never appears in
  // BottomNav — a player should not learn the panel exists from their own nav.
  // The real gate is server-side: every /admin API answers 404 to non-ops.
  {
    path: '/admin',
    element: <AdminShell />,
    // Without this, any admin URL that fails to match — which for a while
    // included a TAB — replaces the whole app with React Router's raw crash
    // page: unstyled, stack-trace-shaped, and confirming to a curious player
    // that something lives under /admin. A styled dead-end instead.
    errorElement: <AdminRouteError />,
    children: [
      { index: true, element: <AdminOverview /> },
      { path: 'withdrawals', element: <AdminWithdrawals /> },
      { path: 'players', element: <AdminPlayers /> },
      { path: 'leagues', element: <AdminLeagues /> },
      { path: 'alerts', element: <AdminAlerts /> },
    ],
  },
  { path: '/table/:id', element: <Table /> },
]);
