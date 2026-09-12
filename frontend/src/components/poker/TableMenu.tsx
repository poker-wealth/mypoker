import { useTranslation } from 'react-i18next';
import { ChevronRight, Share2, Eye, Layers, SlidersHorizontal, Coins, PauseCircle, Store, ShieldCheck, History, LogOut } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/cn';

/**
 * The table's menu drawer, after the reference app's.
 *
 * WHAT IS AND IS NOT HERE, and why.
 *
 * ALL EIGHT ROWS the reference lists, in its order — owner's instruction, and
 * an earlier pass that quietly dropped three was wrong to.
 *
 * Share, Stand up & Watch, Poker Hand Rankings, Options, Buyin, Sit Out,
 * Store, Exit game.
 *
 * Buyin and Sit Out open the SAME controls the table already has rather than
 * reimplementing them: a menu row that opens the footer's sheet is fine, a
 * second way to buy in is not.
 *
 * STAND UP AND SIT OUT ARE DIFFERENT ROWS and must stay that way. Stand up
 * gives the seat up and keeps you watching; Sit out keeps the seat and skips
 * hands. Collapsing them would hide a choice that costs a player their seat.
 *
 * STORE has no backend — no catalogue, no purchase path. It is in the list
 * because the list is the owner's, but it is disabled and says why rather than
 * opening an empty screen or appearing to sell something. Hand Rankings is the
 * same until its chart exists.
 *
 * Every disabled row carries a READABLE REASON beside it. A greyed control with
 * no explanation reads as a feature that exists and is merely quiet.
 */

export interface TableMenuProps {
  open: boolean;
  onClose: () => void;
  /** Share the table's invite link. */
  onShare: () => void;
  /** Give up your seat but keep watching. Absent when you are not seated. */
  onStandUp?: () => void;
  /**
   * Open the hand-rankings chart. Optional because the chart does not exist
   * yet — the row is disabled with a reason until it does, rather than opening
   * nothing.
   */
  onRankings?: () => void;
  /** Open table options (colour, sound, and the rest). */
  onOptions: () => void;
  /** Top up your stack. Absent when not seated. */
  onBuyIn?: () => void;
  /** Keep your seat, skip hands. Absent when not seated. */
  onSitOut?: () => void;
  /** Open the hand-history / table-info panel. */
  onHistory?: () => void;
  /** Open the provably-fair screen. */
  onFairness?: () => void;
  /** Leave the table entirely. */
  onExit: () => void;
}

export function TableMenu({
  open,
  onClose,
  onShare,
  onStandUp,
  onRankings,
  onOptions,
  onBuyIn,
  onSitOut,
  onFairness,
  onHistory,
  onExit,
}: TableMenuProps) {
  const { t } = useTranslation();

  const act = (fn: () => void) => () => {
    // Close first: every one of these opens something else, and two sheets
    // stacked in one context leaves the one underneath bright and clickable.
    onClose();
    fn();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Click-away. The drawer covers less than half the screen, so the
              rest of the table stays visible — and tapping it must close,
              or the visible table looks live while being inert. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40"
          />
          {/* Slides in from the LEFT, full height, matching the reference —
              and the mirror of the chat drawer on the right of this screen.
              Was a bottom Sheet, which is the wrong shape for a list this
              long and does not match the app it is modelled on. */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            /* AS TALL AS ITS CONTENT, not the whole screen — `inset-y-0`
               stretched it to full height and left a long empty panel below
               the last row. The reference ends after "Exit game" and lets the
               table show beneath. `max-h` keeps it scrollable on a short
               screen rather than running off the bottom. */
            className="fixed left-0 top-0 z-50 flex max-h-[88vh] w-[min(68vw,17rem)] flex-col overflow-y-auto rounded-br-2xl border-b border-r border-border bg-surface/95 shadow-2xl backdrop-blur-md"
          >
            <h2 className="px-4 pb-2 pt-5 text-[0.7rem] font-bold uppercase tracking-wider text-dim">
              {t('table.menuTitle')}
            </h2>
            <div className="flex flex-col px-4">
        <Row icon={Share2} label={t('table.menuShare')} onClick={act(onShare)} />

        {/* Disabled WITH its reason, rather than silently greyed. */}
        <Row
          icon={Eye}
          label={t('table.menuStandUp')}
          onClick={onStandUp ? act(onStandUp) : undefined}
          reason={onStandUp ? undefined : t('table.menuNeedSeat')}
        />

        <Row
          icon={Layers}
          label={t('table.menuRankings')}
          onClick={onRankings ? act(onRankings) : undefined}
          reason={onRankings ? undefined : t('table.menuSoon')}
        />
              <Row
                icon={SlidersHorizontal}
                label={t('table.menuOptions')}
                onClick={act(onOptions)}
                chevron
              />

              {/* Buy in — the same sheet the table's own control opens, not a
                  second implementation. Absent unless seated: there is no stack
                  to top up from a chair you are not in. */}
              <Row
                icon={Coins}
                label={t('table.rebuy')}
                onClick={onBuyIn ? act(onBuyIn) : undefined}
                reason={onBuyIn ? undefined : t('table.menuNeedSeat')}
                chevron={Boolean(onBuyIn)}
              />

              {/* Sit out — keeps your seat and skips hands. Deliberately a
                  DIFFERENT row from Stand up above, which gives the seat up.
                  The reference lists both and so does this: collapsing them
                  into one would hide a choice that costs a seat. */}
              <Row
                icon={PauseCircle}
                label={t('table.sitOut')}
                onClick={onSitOut ? act(onSitOut) : undefined}
                reason={onSitOut ? undefined : t('table.menuNeedSeat')}
              />

              {/* STORE. There is no store — no catalogue, no purchase path, no
                  backend. It is in the list because the list is the owner's,
                  but it is disabled and says why rather than opening an empty
                  screen or pretending to sell something. */}
              <Row icon={Store} label={t('table.menuStore')} reason={t('table.menuSoon')} />

              {/* Hand history / table info. The toolbar has four slots and
                  all four are spoken for, so this lives here. */}
              <Row
                icon={History}
                label={t('table.handHistory')}
                onClick={onHistory ? act(onHistory) : undefined}
              />

              {/* Fairness. Not in the reference's list, and here anyway: the
                  spade in the toolbar that used to reach it is now the paid
                  comment button, and the provably-fair screen is the last
                  thing a poker app should make hard to find. */}
              <Row
                icon={ShieldCheck}
                label={t('table.fairness')}
                onClick={onFairness ? act(onFairness) : undefined}
              />

              <Row icon={LogOut} label={t('table.menuExit')} onClick={act(onExit)} tone="danger" />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Row({
  icon: Icon,
  label,
  onClick,
  reason,
  chevron,
  tone,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick?: () => void;
  /** Why this row cannot be used. Renders it disabled, with the reason shown. */
  reason?: string;
  chevron?: boolean;
  tone?: 'danger';
}) {
  const disabled = !onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-3 border-b border-border/60 px-1 py-3.5 text-left last:border-b-0',
        disabled ? 'cursor-not-allowed opacity-45' : 'active:bg-surface-2/60',
      )}
    >
      <Icon size={17} className={cn('shrink-0', tone === 'danger' ? 'text-danger' : 'text-dim')} />
      <span className={cn('min-w-0 flex-1 text-sm', tone === 'danger' ? 'text-danger' : 'text-text')}>
        {label}
      </span>
      {reason ? <span className="shrink-0 text-[0.62rem] text-dim">{reason}</span> : null}
      {chevron && !disabled ? <ChevronRight size={15} className="shrink-0 text-dim" /> : null}
    </button>
  );
}
