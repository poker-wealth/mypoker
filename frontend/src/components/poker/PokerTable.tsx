import type { TableState } from '@/lib/table';
import type { TableDesign } from '@/lib/tableDesigns';
import { PokerCanvas } from './PokerCanvas';

interface PokerTableProps {
  state: TableState;
  /** Live tables: tapping an open chair sits you down (called with the SERVER seat index). */
  onSit?: (seatIndex: number) => void;
  onChallenge?: (playerId: string) => void;
  /** Override the player's chosen design — used by the design picker's previews. */
  design?: TableDesign;
}

export function PokerTable({ state, onSit, onChallenge }: PokerTableProps) {
  return <PokerCanvas state={state} onSit={onSit} onChallenge={onChallenge} />;
}

