import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { haptic } from '@/lib/telegram';
import type { TableState } from '@/lib/table';
import { useTablePrefs, RAISE_PRESETS } from '@/store/tablePrefs';

export type PokerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number };

interface ActionBarProps {
  state: TableState;
  onAction: (action: PokerAction) => void;
}

const FRACTIONS: { key: string; f: number }[] = [
  { key: 'table.halfPot', f: 0.5 },
  { key: 'table.threeQuarterPot', f: 0.75 },
  { key: 'table.pot', f: 1 },
];

/** Hero's betting controls. `raise.to` is the total the bet is raised to. */
export function ActionBar({ state, onAction }: ActionBarProps) {
  const { t } = useTranslation();
  const hero = state.seats[state.heroSeat];
  const canCheck = state.toCall === 0;
  const maxRaiseTo = hero.bet + hero.stack;
  const minRaiseTo = Math.min(state.currentBet + state.minRaise, maxRaiseTo);
  const canRaise = hero.stack > state.toCall;
  const potForSizing = state.pot + state.seats.reduce((n, s) => n + s.bet, 0);

  /**
   * THE PLAYER'S DEFAULT RAISE, from table settings.
   *
   * That preference was being saved and never read — the same fault the
   * four-colour deck had. Someone who set "1x" got the slider at the minimum
   * raise every street regardless, so the setting did nothing at all.
   *
   * A custom amount is in BIG BLINDS, which is how the setting is labelled;
   * everything else is a fraction of the pot, matching the chips above the
   * slider. Both are clamped into the legal range, so a default larger than
   * the stack becomes an all-in rather than an illegal bet.
   */
  const defaultRaise = useTablePrefs((s) => s.defaultRaise);
  const customRaise = useTablePrefs((s) => s.customRaise);

  const openingRaise = useMemo(() => {
    const clampLegal = (n: number) => Math.max(minRaiseTo, Math.min(Math.round(n), maxRaiseTo));
    if (customRaise !== null) return clampLegal(state.currentBet + customRaise * (state.bigBlind ?? state.minRaise));
    const preset = RAISE_PRESETS.find((p) => p.id === defaultRaise);
    if (!preset) return minRaiseTo;
    return clampLegal(state.currentBet + potForSizing * preset.fraction);
  }, [customRaise, defaultRaise, minRaiseTo, maxRaiseTo, potForSizing, state.currentBet, state.bigBlind, state.minRaise]);

  const [raiseTo, setRaiseTo] = useState(openingRaise);

  /**
   * Re-seed when the street moves.
   *
   * Keyed on the legal minimum rather than on every render: the pot grows as
   * chips go in mid-street, and re-seeding on that would drag the slider out
   * from under a player who had already set their size.
   */
  const seededFor = useRef<number | null>(null);
  useEffect(() => {
    if (seededFor.current === minRaiseTo) return;
    seededFor.current = minRaiseTo;
    setRaiseTo(openingRaise);
  }, [minRaiseTo, openingRaise]);
  const clamped = useMemo(
    () => Math.max(minRaiseTo, Math.min(raiseTo, maxRaiseTo)),
    [raiseTo, minRaiseTo, maxRaiseTo],
  );

  /**
   * Ask before committing a bet, when the player has turned it on.
   *
   * Disarmed whenever the amount or the street changes: a confirmation has to
   * belong to the number the player last looked at, or the second tap sends a
   * size they never agreed to.
   */
  const confirmBets = useTablePrefs((s) => s.confirmBets);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
  }, [clamped, minRaiseTo]);

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
              {FRACTIONS.map(({ key, f }) => (
                <button
                  key={key}
                  onClick={() => sizeTo(f)}
                  className="rounded-full border border-border bg-surface px-2.5 py-1 text-[0.68rem] font-semibold text-dim active:bg-surface-2"
                >
                  {t(key)}
                </button>
              ))}
              <button
                onClick={() => setRaiseTo(maxRaiseTo)}
                className="rounded-full border border-border bg-surface px-2.5 py-1 text-[0.68rem] font-semibold text-brand active:bg-surface-2"
              >
                {t('table.allIn')}
              </button>
            </div>
            <div className="ml-auto text-sm font-bold tabular-nums">${clamped.toLocaleString()}</div>
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
          {t('table.fold')}
        </Button>
        {canCheck ? (
          <Button variant="secondary" full onClick={() => fire({ type: 'check' })}>
            {t('table.check')}
          </Button>
        ) : (
          <Button variant="secondary" full onClick={() => fire({ type: 'call' })}>
            {t('table.call', { amount: `$${state.toCall.toLocaleString()}` })}
          </Button>
        )}
        {/* SLIDER + CONFIRM, when the player has asked for it.
            A bet dragged on a slider is easy to send by accident — the whole
            point of the setting. The first tap arms, the second commits, and
            the armed label says what it is about to do so the confirmation is
            a real one rather than a second identical button.

            Armed state resets whenever the amount or the street changes: a
            confirmation must belong to the number the player last saw. */}
        <motion.div whileTap={{ scale: 0.97 }}>
          <Button
            full
            disabled={!canRaise}
            variant={armed ? 'danger' : 'primary'}
            onClick={() => {
              if (confirmBets && !armed) {
                setArmed(true);
                return;
              }
              setArmed(false);
              fire({ type: 'raise', to: clamped });
            }}
          >
            {armed
              ? t('table.confirmRaise', { amount: `$${clamped.toLocaleString()}` })
              : `${canCheck ? t('table.bet') : t('table.raise')} ${canRaise ? `$${clamped.toLocaleString()}` : ''}`}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
