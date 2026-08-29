import { create } from 'zustand';
import { DEFAULT_DESIGN_ID, designById, type TableDesign } from '@/lib/tableDesigns';

/**
 * Which table the player likes looking at. Persisted, because a felt you chose once should still be
 * there next time you sit down — the same reasoning as the theme store next door.
 */

const STORAGE_KEY = 'fp-table-design';

interface TableDesignState {
  id: string;
  design: TableDesign;
  /**
   * Whether this is a felt the PLAYER picked, rather than the app's default.
   *
   * A game can carry its own table (Short Deck is not played on the Hold'em
   * felt), but only for players who never expressed a preference. Without this
   * flag the two are indistinguishable — the stored default and a deliberate
   * choice look identical — and a game default would silently overwrite
   * something the player had chosen.
   */
  chosen: boolean;
  setDesign: (id: string) => void;
}

/**
 * Read at module load, so it has to survive there being no browser: this module is now pulled in by
 * any felt that draws the chosen table, and touching `localStorage` at import time throws outright
 * in a plain node context (a test, a prerender). A missing store just means the default design.
 */
const hasStorage = typeof localStorage !== 'undefined';
const stored = (hasStorage ? localStorage.getItem(STORAGE_KEY) : null) ?? DEFAULT_DESIGN_ID;

/** Something was in storage → the player chose it at some point. */
const wasChosen = hasStorage && localStorage.getItem(STORAGE_KEY) !== null;

export const useTableDesign = create<TableDesignState>((set) => ({
  id: designById(stored).id, // resolve, so a removed design falls back instead of blanking the table
  design: designById(stored),
  chosen: wasChosen,
  setDesign: (id) => {
    const design = designById(id);
    if (hasStorage) localStorage.setItem(STORAGE_KEY, design.id);
    // Picking one — even the same one again — makes it theirs, and from here on
    // no game default overrides it.
    set({ id: design.id, design, chosen: true });
  },
}));
