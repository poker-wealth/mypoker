import { useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Link2, Check } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { CreateGameScreen } from '@/components/table-setup/CreateGameScreen';
import { toast } from '@/lib/toast';
import { DEFAULT_TABLE_ID } from '@/config';

/**
 * Tapping Hold'em opens this (owner-approved; not in the FairPlay doc): join the
 * open public table, or open your own. A created table hands back a shareable
 * `/table/<id>` link the creator can send to a friend.
 *
 * A CENTERED Modal, not a bottom sheet — Victor asked for the dialog in the
 * middle of the screen with a dimmed backdrop.
 *
 * The create form itself is `CreateGameScreen`: the full-page, reference-styled
 * settings screen (chip sliders, chip toggles, Start now). This modal keeps two
 * jobs — the join/create choice, and showing the invite link afterwards.
 *
 * "Join" goes to DEFAULT_TABLE_ID, exactly what the tile did before this
 * existed, so nothing is lost for a player who just wants a seat.
 */
export function TableEntryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const close = (): void => {
    setCreating(false);
    setCreatedId(null);
    setCopied(false);
    onClose();
  };

  const inviteLink = createdId ? `${window.location.origin}/table/${createdId}` : '';

  const join = (): void => {
    navigate(`/table/${DEFAULT_TABLE_ID}`);
    close();
  };

  const copy = (): void => {
    if (!inviteLink) return;
    void navigator.clipboard
      ?.writeText(inviteLink)
      .then(() => {
        setCopied(true);
        toast.success(t('tableEntry.copied'));
      })
      .catch(() => {
        // Clipboard can be unavailable in a locked-down WebView; the link is on
        // screen and selectable, so a failed copy is a nuisance, not a dead end.
      });
  };

  const enter = (): void => {
    if (!createdId) return;
    navigate(`/table/${createdId}`);
    close();
  };

  return (
    <>
      <Modal open={open} onClose={close} title={t('tableEntry.title')}>
        {createdId ? (
          <div className="space-y-3">
            <div className="space-y-2.5 rounded-(--radius-app) border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <Check size={16} className="shrink-0 text-brand" />
                <span className="font-semibold">{t('tableEntry.ready')}</span>
              </div>
              <p className="text-[0.7rem] leading-relaxed text-dim">{t('tableEntry.shareBlurb')}</p>
              <div className="flex items-center gap-2 rounded-(--radius-app) border border-border bg-surface-2 px-3 py-2">
                <Link2 size={14} className="shrink-0 text-dim" />
                <span className="min-w-0 flex-1 truncate text-[0.7rem] text-text">{inviteLink}</span>
              </div>
            </div>
            <Button full variant="ghost" onClick={copy}>
              {copied ? t('tableEntry.copied') : t('tableEntry.copy')}
            </Button>
            <Button full onClick={enter}>
              {t('tableEntry.enter')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <OptionRow
              icon={Users}
              title={t('tableEntry.joinExisting')}
              blurb={t('tableEntry.joinBlurb')}
              onClick={join}
            />
            <OptionRow
              icon={Plus}
              title={t('tableEntry.createNew')}
              blurb={t('tableEntry.createBlurb')}
              onClick={() => setCreating(true)}
            />
          </div>
        )}
      </Modal>

      <CreateGameScreen
        open={open && creating && !createdId}
        onClose={() => setCreating(false)}
        onCreated={(table) => {
          setCreating(false);
          setCreatedId(table.tableId);
        }}
      />
    </>
  );
}

function OptionRow({
  icon: Icon,
  title,
  blurb,
  onClick,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  blurb: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-(--radius-app) border border-border bg-surface p-4 text-left transition active:scale-[0.99]"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-brand">
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block text-[0.7rem] text-dim">{blurb}</span>
      </span>
    </button>
  );
}
