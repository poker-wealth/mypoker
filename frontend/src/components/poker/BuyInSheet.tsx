import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { TipsDialog } from '@/components/ui/TipsDialog';
import { chips } from '@/lib/money';

/**
 * Joining a table — the reference app's dialog, part for part: the table's
 * name up top, the blinds and the chosen buy-in as the two gold figures, a
 * gold Min–Max slider, the "total coins" line, and the gold Join Game button.
 *
 * A centered Modal rather than a bottom sheet, because that is what the
 * reference shows over the felt. The server re-checks every number in here.
 *
 * A bankroll below the table minimum gets the reference's "Tips" alert
 * instead of the form — Cancel stays, Purchase goes to the wallet.
 */
export function BuyInSheet({
  open,
  onClose,
  tableName,
  smallBlind,
  min,
  max,
  bigBlind,
  available,
  seatIndex,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  /** Shown as the dialog title, as in the reference. */
  tableName: string;
  smallBlind: number;
  /** Chip range this table allows. */
  min: number;
  max: number;
  bigBlind: number;
  /** What the player has outside the table. */
  available: number;
  /** Seat being taken — null when topping up the seat you already hold. */
  seatIndex: number | null;
  onConfirm: (amount: number) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ceiling = Math.min(max, available);
  const [amount, setAmount] = useState(() => Math.min(ceiling, max));

  // Re-anchor whenever the sheet opens: the bankroll may have changed since last time.
  useEffect(() => {
    if (open) setAmount(Math.min(ceiling, max));
  }, [open, ceiling, max]);

  const shortfall = available < min;
  const clamped = useMemo(() => Math.max(min, Math.min(amount, ceiling)), [amount, min, ceiling]);

  if (shortfall) {
    return (
      <TipsDialog
        open={open}
        title={t('tips.title')}
        message={t('tips.notEnough')}
        cancelLabel={t('common.cancel')}
        actionLabel={t('tips.purchase')}
        onCancel={onClose}
        onAction={() => {
          onClose();
          navigate('/wallet');
        }}
      />
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={tableName}>
      <div className="space-y-5 px-2 pt-2">
        {/* The two gold figures: stakes, and what this player sits with. */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[0.66rem] text-dim">{t('buyInSheet.blinds')}</div>
            <div className="mt-1 text-3xl font-black tabular-nums text-gold">
              {smallBlind}/{bigBlind}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[0.66rem] text-dim">{t('buyInSheet.buyIn')}</div>
            <div className="mt-1 text-3xl font-black tabular-nums text-gold">
              {clamped.toLocaleString()}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-[0.66rem] text-dim">
            <span>{t('buyInSheet.min')}</span>
            <span>{t('buyInSheet.max')}</span>
          </div>
          <input
            type="range"
            min={min}
            max={ceiling}
            step={bigBlind}
            value={clamped}
            onChange={(e) => setAmount(Number(e.target.value))}
            aria-label={t('buyInSheet.buyIn')}
            className="w-full accent-[var(--gold)]"
          />
        </div>

        <div className="space-y-1 border-t border-border pt-3 text-[0.72rem]">
          <div className="flex justify-between text-dim">
            <span>{t('buyInSheet.totalCoins')}</span>
            <span className="tabular-nums text-text">{chips(available)}</span>
          </div>
          <div className="flex justify-between text-dim">
            <span>{t('buyInSheet.bigBlinds')}</span>
            <span className="tabular-nums text-text">{Math.floor(clamped / bigBlind)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onConfirm(clamped)}
          className="w-full rounded-(--radius-app) bg-gold py-3 text-sm font-bold text-bg transition active:scale-[0.98]"
        >
          {seatIndex === null ? t('buyInSheet.addChips') : t('buyInSheet.joinGame')}
        </button>
      </div>
    </Modal>
  );
}
