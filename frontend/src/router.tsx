import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Lobby } from '@/pages/Lobby';
import { Games } from '@/pages/Games';
import { Wallet } from '@/pages/Wallet';
import { Profile } from '@/pages/Profile';
import { Table } from '@/pages/Table';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Lobby /> },
      { path: 'games', element: <Games /> },
      { path: 'wallet', element: <Wallet /> },
      { path: 'profile', element: <Profile /> },
    ],
  },
  // Full-screen game table (no bottom nav / shell chrome).
  { path: '/table/:id', element: <Table /> },
]);
