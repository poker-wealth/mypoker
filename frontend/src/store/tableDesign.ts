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
  setDesign: (id: string) => void;
}

/**
 * Read at module load, so it has to survive there being no browser: this module is now pulled in by
 * any felt that draws the chosen table, and touching `localStorage` at import time throws outright
 * in a plain node context (a test, a prerender). A missing store just means the default design.
 */
const hasStorage = typeof localStorage !== 'undefined';
const stored = (hasStorage ? localStorage.getItem(STORAGE_KEY) : null) ?? DEFAULT_DESIGN_ID;

/**
 * There was a `chosen` flag here, to tell "the player picked this felt" apart
 * from "this is the stored default", so a game's own table could override only
 * the latter. It was written and never read: the rule settled as the player
 * picking the COLOUR and the game picking the SHAPE, which needs no such flag —
 * the two no longer compete for the same property. Removed rather than left
 * lying around, because a flag nobody reads still has to be disproved by the
 * next person to touch this.
 */
export const useTableDesign = create<TableDesignState>((set) => ({
  id: designById(stored).id, // resolve, so a removed design falls back instead of blanking the table
  design: designById(stored),
  setDesign: (id) => {
    const design = designById(id);
    if (hasStorage) localStorage.setItem(STORAGE_KEY, design.id);
    set({ id: design.id, design });
  },
}));
