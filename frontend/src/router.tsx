import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Alliance } from '@/pages/Alliance';
import { Lobby } from '@/pages/Lobby';
import { Games } from '@/pages/Games';
import { Data } from '@/pages/Data';
import { Wallet } from '@/pages/Wallet';
import { Profile } from '@/pages/Profile';
import { Settings } from '@/pages/Settings';
import { Fairness } from '@/pages/Fairness';
import { Jackpot } from '@/pages/Jackpot';
import { Vip } from '@/pages/Vip';
import { Notifications } from '@/pages/Notifications';
import { AgentCenter } from '@/pages/AgentCenter';
import { Table } from '@/pages/Table';
import { DemoPage } from '@/demo/DemoPage';
import { Login } from '@/pages/Login';

import { DouDiZhuSimulatorFelt } from '@/components/games/DouDiZhuSimulatorFelt';

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
  // Full-screen game table & simulators (no bottom nav / shell chrome).
  { path: '/table/:id', element: <Table /> },
  // Bull Bull IS Niu Niu. It used to be a second, play-money copy of the same game; the betting
  // structure now lives on the table that settles through the ledger, so the old link lands there.
  { path: '/simulator/bull-bull', element: <Navigate to='/table/niu-niu' replace /> },
  { path: '/simulator/dou-di-zhu', element: <DouDiZhuSimulatorFelt /> },
  // THROWAWAY: the scripted walkthrough of every game. Delete this line and src/demo/ to remove.
  { path: '/demo', element: <DemoPage /> },
]);
