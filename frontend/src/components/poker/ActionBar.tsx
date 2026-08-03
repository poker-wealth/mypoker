import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { haptic } from '@/lib/telegram';
import type { TableState } from '@/lib/table';

export type PokerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number };

interface ActionBarProps {
  state: TableState;
  onAction: (action: PokerAction) => void;
}

const FRACTIONS: { label: string; f: number }[] = [
  { label: '½ Pot', f: 0.5 },
  { label: '¾ Pot', f: 0.75 },
  { label: 'Pot', f: 1 },
];

/** Hero's betting controls. `raise.to` is the total the bet is raised to. */
export function ActionBar({ state, onAction }: ActionBarProps) {
  const hero = state.seats[state.heroSeat];
  const canCheck = state.toCall === 0;
  const maxRaiseTo = hero.bet + hero.stack;
  const minRaiseTo = Math.min(state.currentBet + state.minRaise, maxRaiseTo);
  const canRaise = hero.stack > state.toCall;
  const potForSizing = state.pot + state.seats.reduce((n, s) => n + s.bet, 0);

  const [raiseTo, setRaiseTo] = useState(minRaiseTo);
  const clamped = useMemo(
    () => Math.max(minRaiseTo, Math.min(raiseTo, maxRaiseTo)),
    [raiseTo, minRaiseTo, maxRaiseTo],
  );

  const fire = (a: PokerAction) => {
    haptic('medium');
    onAction(a);
  };

  const sizeTo = (f: number) =>
    setRaiseTo(Math.max(minRaiseTo, Math.min(state.currentBet + Math.round(potForSizing * f), maxRaiseTo)));

  return (
    <div className="space-y-3">
      {canRaise && (
        <>
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              {FRACTIONS.map(({ label, f }) => (
                <button
                  key={label}
                  onClick={() => sizeTo(f)}
                  className="rounded-full border border-border bg-surface px-2.5 py-1 text-[0.68rem] font-semibold text-dim active:bg-surface-2"
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => setRaiseTo(maxRaiseTo)}
                className="rounded-full border border-border bg-surface px-2.5 py-1 text-[0.68rem] font-semibold text-brand active:bg-surface-2"
              >
                All-in
              </button>
            </div>
            <div className="ml-auto text-sm font-bold tabular-nums">₮{clamped.toLocaleString()}</div>
          </div>

          <input
            type="range"
            min={minRaiseTo}
            max={maxRaiseTo}
            value={clamped}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
            className="w-full accent-[var(--brand)]"
          />
        </>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        <Button variant="danger" full onClick={() => fire({ type: 'fold' })}>
          Fold
        </Button>
        {canCheck ? (
          <Button variant="secondary" full onClick={() => fire({ type: 'check' })}>
            Check
          </Button>
        ) : (
          <Button variant="secondary" full onClick={() => fire({ type: 'call' })}>
            Call ₮{state.toCall.toLocaleString()}
          </Button>
        )}
        <motion.div whileTap={{ scale: 0.97 }}>
          <Button full disabled={!canRaise} onClick={() => fire({ type: 'raise', to: clamped })}>
            {canCheck ? 'Bet' : 'Raise'} {canRaise ? `₮${clamped.toLocaleString()}` : ''}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
