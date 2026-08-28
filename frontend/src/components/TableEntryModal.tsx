import { useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Link2, Check, Globe, Lock } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { useCreatePlayerTable } from '@/api/hooks';
import { logError } from '@/api/errors';
import { toast } from '@/lib/toast';
import { DEFAULT_TABLE_ID } from '@/config';
import type { TableVisibility } from '@/api/tables';

/**
 * Tapping Hold'em opens this (owner-approved; not in the FairPlay doc): join the
 * open public table, or open your own — public (listed in the lobby) or private
 * ("play with friends", reachable only by the link). A created table hands back
 * a shareable `/table/<id>` link the creator can send to a friend.
 *
 * A CENTERED Modal, not a bottom sheet — Victor asked for the dialog in the
 * middle of the screen with a dimmed backdrop.
 *
 * Hold'em only for now — the create endpoint's enum is `texas` — so it is wired
 * to that one tile in Games; the others still navigate straight to felt. "Join"
 * goes to DEFAULT_TABLE_ID, exactly what the tile did before this existed, so
 * nothing is lost for a player who just wants a seat.
 */
export function TableEntryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreatePlayerTable();

  const [step, setStep] = useState<'choose' | 'create'>('choose');
  const [visibility, setVisibility] = useState<TableVisibility>('public');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const close = (): void => {
    setStep('choose');
    setVisibility('public');
    setCreatedId(null);
    setCopied(false);
    create.reset();
    onClose();
  };

  const inviteLink = createdId ? `${window.location.origin}/table/${createdId}` : '';

  const join = (): void => {
    navigate(`/table/${DEFAULT_TABLE_ID}`);
    close();
  };

  const submit = (): void => {
    create.mutate(
      { game: 'texas', visibility },
      {
        onSuccess: (table) => setCreatedId(table.tableId),
        onError: (e) => {
          logError('createPlayerTable', e);
          toast.error(t('tableEntry.error'));
        },
      },
    );
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

  const VIS: TableVisibility[] = ['public', 'private'];

  return (
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
      ) : step === 'choose' ? (
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
            onClick={() => setStep('create')}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-[0.66rem] font-semibold text-dim">{t('tableEntry.who')}</span>
            <Segmented
              options={VIS.map((v) => ({ value: v, label: t(`tableEntry.${v}`) }))}
              value={visibility}
              onChange={setVisibility}
            />
          </label>

          <div className="flex items-start gap-2.5 rounded-(--radius-app) border border-border bg-surface p-3">
            {visibility === 'public' ? (
              <Globe size={15} className="mt-0.5 shrink-0 text-accent" />
            ) : (
              <Lock size={15} className="mt-0.5 shrink-0 text-brand" />
            )}
            <p className="text-[0.7rem] leading-relaxed text-dim">
              {visibility === 'public' ? t('tableEntry.publicBlurb') : t('tableEntry.privateBlurb')}
            </p>
          </div>

          <Button full disabled={create.isPending} onClick={submit}>
            {create.isPending ? t('common.loading') : t('tableEntry.createCta')}
          </Button>
        </div>
      )}
    </Modal>
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
