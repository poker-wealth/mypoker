import { useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Link2, Check, KeyRound, Copy } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { CreateGameScreen } from '@/components/table-setup/CreateGameScreen';
import { cn } from '@/lib/cn';
import { toast } from '@/lib/toast';
import { DEFAULT_TABLE_ID, TELEGRAM_APP_NAME, TELEGRAM_BOT_NAME } from '@/config';
import { inviteUrl } from '@/lib/tableInvite';

/**
 * Tapping Hold'em opens this (owner-approved; not in the FairPlay doc): join the
 * open public table, or open your own. A created table hands back a shareable
 * `/table/<id>` link the creator can send to a friend — and, for a PRIVATE
 * table, the join code that link carries.
 *
 * A CENTERED Modal, not a bottom sheet — Victor asked for the dialog in the
 * middle of the screen with a dimmed backdrop.
 *
 * The create form itself is `CreateGameScreen`: the full-page, reference-styled
 * settings screen (chip sliders, chip toggles, Start now). This modal keeps two
 * jobs — the join/create choice, and showing the invite link (and private code)
 * afterwards.
 *
 * "Join" goes to DEFAULT_TABLE_ID, exactly what the tile did before this
 * existed, so nothing is lost for a player who just wants a seat.
 */
export function TableEntryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  /** Private tables only; null for public. See CreatedTable.joinCode. */
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const close = (): void => {
    setCreating(false);
    setCreatedId(null);
    setCreatedCode(null);
    setCopied(false);
    onClose();
  };

  /**
   * The code rides in the link.
   *
   * Not decoration: a private table now REFUSES anyone who has not presented
   * its code, and before this change the link was the only thing a creator had
   * to send. A link without the code would therefore have been a link that no
   * longer works — closing the hole would have broken sharing. The code is also
   * shown separately below, for reading aloud when a link cannot be pasted.
   */
  const inviteLink = createdId
    ? inviteUrl(
        { tableId: createdId, ...(createdCode ? { code: createdCode } : {}) },
        TELEGRAM_BOT_NAME,
        TELEGRAM_APP_NAME,
      )
    : '';

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
    // The creator already holds access server-side — they were just handed the
    // code — so this needs no `?code=`. It is carried anyway so that a reload
    // of the resulting URL still works from a fresh session.
    navigate(`/table/${createdId}${createdCode ? `?code=${createdCode}` : ''}`);
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
              <p className="text-[0.7rem] leading-relaxed text-dim">
                {createdCode ? t('tableEntry.shareBlurbPrivate') : t('tableEntry.shareBlurb')}
              </p>
              {/* The copy control lives ON the link, not under it.
                  It used to be a full-width ghost button below the box, which
                  renders as plain text — so the row above looked inert and the
                  button looked like a caption, and nobody could tell either was
                  tappable. Now the whole row is the button, with a labelled
                  Copy chip at its right edge saying so. */}
              <button
                type="button"
                onClick={copy}
                aria-label={t('tableEntry.copy')}
                className="flex w-full items-center gap-2 rounded-(--radius-app) border border-border bg-surface-2 px-3 py-2 text-left transition-colors hover:border-brand/60"
              >
                <Link2 size={14} className="shrink-0 text-dim" />
                <span className="min-w-0 flex-1 truncate text-[0.7rem] text-text">{inviteLink}</span>
                <span
                  className={cn(
                    'flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[0.62rem] font-bold transition-colors',
                    copied ? 'bg-success/15 text-success' : 'bg-brand/15 text-brand',
                  )}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? t('tableEntry.copied') : t('tableEntry.copy')}
                </span>
              </button>
              {/* The code, shown on its own so it can be read out. Spaced and
                  tabular so six digits are unambiguous when spoken. */}
              {createdCode ? (
                <div className="flex items-center gap-2 rounded-(--radius-app) border border-border bg-surface-2 px-3 py-2">
                  <KeyRound size={14} className="shrink-0 text-brand" />
                  <div className="min-w-0 flex-1">
                    <span className="block text-[0.62rem] font-semibold text-dim">
                      {t('tableEntry.codeLabel')}
                    </span>
                    <span className="block font-mono text-[0.95rem] tracking-[0.3em] tabular-nums text-text">
                      {createdCode}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
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
          // Private tables carry a join code; public ones return null.
          setCreatedCode(table.joinCode ?? null);
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
