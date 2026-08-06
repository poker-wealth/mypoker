import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';

interface BuyInSheetProps {
  open: boolean;
  onClose: () => void;
  /** Chip range this table allows. */
  min: number;
  max: number;
  bigBlind: number;
  /** What the player has outside the table. */
  available: number;
  /** Seat being taken — null when topping up the seat you already hold. */
  seatIndex: number | null;
  onConfirm: (amount: number) => void;
}

/** Choosing what to sit down with. The server re-checks every number in here. */
export function BuyInSheet({
  open,
  onClose,
  min,
  max,
  bigBlind,
  available,
  seatIndex,
  onConfirm,
}: BuyInSheetProps) {
  const ceiling = Math.min(max, available);
  const [amount, setAmount] = useState(() => Math.min(ceiling, max));

  // Re-anchor whenever the sheet opens: the bankroll may have changed since last time.
  useEffect(() => {
    if (open) setAmount(Math.min(ceiling, max));
  }, [open, ceiling, max]);

  const shortfall = available < min;
  const clamped = useMemo(() => Math.max(min, Math.min(amount, ceiling)), [amount, min, ceiling]);

  return (
    <Sheet open={open} onClose={onClose} title={seatIndex === null ? 'Add chips' : `Take seat ${seatIndex + 1}`}>
      <div className="space-y-5 px-4 pt-4">
        {shortfall ? (
          <div className="rounded-(--radius-app) border border-border bg-surface p-4 text-center text-sm text-dim">
            You need at least <span className="font-bold text-text">₮{min.toLocaleString()}</span> to
            sit at this table, and you have ₮{available.toLocaleString()}.
          </div>
        ) : (
          <>
            <div className="text-center">
              <div className="text-3xl font-black tabular-nums">₮{clamped.toLocaleString()}</div>
              <div className="mt-1 text-[0.7rem] text-dim">
                {Math.floor(clamped / bigBlind)} big blinds · you have ₮{available.toLocaleString()}
              </div>
            </div>

            <input
              type="range"
              min={min}
              max={ceiling}
              step={bigBlind}
              value={clamped}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full accent-[var(--brand)]"
            />

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Min', value: min },
                { label: '½ Max', value: Math.max(min, Math.floor(ceiling / 2)) },
                { label: 'Max', value: ceiling },
              ].map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => setAmount(preset.value)}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-[0.72rem] font-semibold text-dim active:bg-surface-2"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <Button full onClick={() => onConfirm(clamped)}>
              {seatIndex === null ? 'Add chips' : 'Sit down'}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
