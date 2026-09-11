import { useTranslation } from 'react-i18next';
import { ChevronRight, Share2, Eye, Layers, SlidersHorizontal, LogOut } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/cn';

/**
 * The table's menu drawer, after the reference app's.
 *
 * WHAT IS AND IS NOT HERE, and why.
 *
 * The reference lists eight rows. Five are wired to things this platform
 * actually does — Share, Stand up & Watch, Hand Rankings, Options, Exit. Two
 * more (Buyin, Sit Out) exist as controls elsewhere on the table already, so
 * they are passed in as optional handlers rather than duplicated: a menu row
 * that opens the same sheet the footer opens is fine, a second implementation
 * of buying in is not.
 *
 * STORE IS ABSENT. There is no store — no catalogue, no purchase path, no
 * backend. The reference greys it out; a greyed row with no explanation is a
 * control that looks like it will work later, and this project's rule is that
 * a disabled control needs a reason the player can read. Rather than invent
 * one, the row is not drawn at all.
 *
 * Rows that are genuinely unavailable RIGHT NOW — standing up when you are not
 * seated — are disabled WITH that reason shown beside them.
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
    <Sheet open={open} onClose={onClose} title={t('table.menuTitle')}>
      <div className="flex flex-col">
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
        <Row icon={SlidersHorizontal} label={t('table.menuOptions')} onClick={act(onOptions)} chevron />
        <Row icon={LogOut} label={t('table.menuExit')} onClick={act(onExit)} tone="danger" />
      </div>
    </Sheet>
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
