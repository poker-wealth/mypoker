import { Modal } from '@/components/ui/Modal';

/**
 * The reference app's "Tips" alert: a small centered card — title, one plain
 * sentence, Cancel on the left, the action on the right as text buttons.
 *
 * Built for the not-enough-money moments (a buy-in or fee the balance cannot
 * cover), where the action is "go to the wallet"; the copy stays the caller's
 * so the dialog never invents a reason.
 */
export function TipsDialog({
  open,
  title,
  message,
  cancelLabel,
  actionLabel,
  onCancel,
  onAction,
}: {
  open: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  actionLabel: string;
  onCancel: () => void;
  onAction: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="px-2 pb-4 text-center text-sm leading-relaxed text-text">{message}</p>
      <div className="flex items-stretch border-t border-border text-sm font-semibold">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 text-accent transition active:bg-surface-2"
        >
          {cancelLabel}
        </button>
        <span className="w-px bg-border" />
        <button
          type="button"
          onClick={onAction}
          className="flex-1 py-3 text-accent transition active:bg-surface-2"
        >
          {actionLabel}
        </button>
      </div>
    </Modal>
  );
}
