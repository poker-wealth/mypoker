import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Where the app is, and how to move.
 *
 * Five tabs plus a table that opens over them, which is the Mini App's shape exactly. There is no
 * router here on purpose: React Navigation is the app shell's choice to make, and standing one up
 * now would mean Samuel either adopts mine or unpicks it. This is small enough to delete in a
 * minute when his lands — the screens themselves know nothing about it beyond `useNav()`.
 */

export type Tab = 'alliance' | 'games' | 'lobby' | 'data' | 'profile';

/** A table opened on top of the tabs, or null when the tabs are what you see. */
export interface OpenTable {
  tableId: string;
  name: string;
}

interface Nav {
  tab: Tab;
  table: OpenTable | null;
  goTab: (tab: Tab) => void;
  openTable: (table: OpenTable) => void;
  closeTable: () => void;
}

const NavContext = createContext<Nav | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>('lobby');
  const [table, setTable] = useState<OpenTable | null>(null);

  const value = useMemo<Nav>(
    () => ({
      tab,
      table,
      goTab: (next) => {
        // Leaving for another tab closes the table — the socket should not stay open behind a
        // screen the player has walked away from.
        setTable(null);
        setTab(next);
      },
      openTable: setTable,
      closeTable: () => setTable(null),
    }),
    [tab, table],
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav used outside NavProvider');
  return nav;
}
