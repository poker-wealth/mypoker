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

const stored = localStorage.getItem(STORAGE_KEY) ?? DEFAULT_DESIGN_ID;

export const useTableDesign = create<TableDesignState>((set) => ({
  id: designById(stored).id, // resolve, so a removed design falls back instead of blanking the table
  design: designById(stored),
  setDesign: (id) => {
    const design = designById(id);
    localStorage.setItem(STORAGE_KEY, design.id);
    set({ id: design.id, design });
  },
}));
