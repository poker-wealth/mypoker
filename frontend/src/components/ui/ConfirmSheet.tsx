import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';
import { Button } from './Button';
import { Input } from './Input';

/**
 * Money confirmations, in a Sheet rather than a native dialog.
 *
 * Two reasons this exists, and either alone would be enough:
 *
 *   SAMUEL.md is explicit — "Confirm every money action in a `Sheet`". The
 *   admin screens were using window.confirm/window.prompt, which is a browser
 *   chrome dialog: no design system, no theme, no i18n, no reduced-motion.
 *
 *   This app runs inside a Telegram Mini App WebView, where native dialogs are
 *   discouraged and unreliable — window.prompt in particular. A blocked dialog
 *   fails CLOSED here (no confirmation, no mutation), so nothing moves money by
 *   accident; but an administrator clicking Approve and watching nothing happen
 *   is its own kind of broken, and the two-person rule cannot be exercised at
 *   all if the second signer's dialog never opens.
 *
 * Deliberately promise-based so it reads like the `window.confirm` it replaces
 * and the call sites keep their shape:
 *
 *     if (!(await confirm({ title: '…', body: '…' }))) return;
 *     const reason = await prompt({ title: 'Why?' });   // null when cancelled
 */

interface ConfirmRequest {
  title: string;
  body?: ReactNode;
  /** Label for the affirmative button. Name the ACTION, never "OK". */
  confirmLabel?: string;
  /** Collect a line of text; resolves to the string, or null if cancelled. */
  withInput?: { label: string; placeholder?: string; required?: boolean };
  danger?: boolean;
}

type Pending = ConfirmRequest & { resolve: (value: string | boolean | null) => void };

export function useConfirmSheet(): {
  confirm: (req: ConfirmRequest) => Promise<boolean>;
  prompt: (req: ConfirmRequest & { withInput: NonNullable<ConfirmRequest['withInput']> }) => Promise<string | null>;
  sheet: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  // A ref as well as state: settle() runs from a click handler and from the
  // backdrop, and both must resolve exactly one promise even if React batches.
  const settled = useRef(false);

  const open = useCallback((req: ConfirmRequest): Promise<string | boolean | null> => {
    settled.current = false;
    setValue('');
    return new Promise((resolve) => setPending({ ...req, resolve }));
  }, []);

  const settle = useCallback(
    (result: string | boolean | null): void => {
      if (settled.current) return;
      settled.current = true;
      pending?.resolve(result);
      setPending(null);
    },
    [pending],
  );

  const confirm = useCallback(
    async (req: ConfirmRequest): Promise<boolean> => (await open(req)) === true,
    [open],
  );

  const prompt = useCallback(
    async (req: ConfirmRequest & { withInput: NonNullable<ConfirmRequest['withInput']> }): Promise<string | null> => {
      const r = await open(req);
      return typeof r === 'string' ? r : null;
    },
    [open],
  );

  const needsInput = pending?.withInput;
  const blocked = Boolean(needsInput?.required) && value.trim().length === 0;

  const sheet = pending ? (
    // Cancel on backdrop dismiss — the safe answer for a money action is "no".
    <Sheet open onClose={() => settle(needsInput ? null : false)} title={pending.title}>
      <div className="space-y-3 px-4 py-3">
        {pending.body && <div className="text-[0.72rem] leading-relaxed text-dim">{pending.body}</div>}

        {needsInput && (
          <label className="block space-y-1">
            <span className="text-[0.66rem] font-semibold text-dim">{needsInput.label}</span>
            <Input
              value={value}
              onChange={setValue}
              {...(needsInput.placeholder ? { placeholder: needsInput.placeholder } : {})}
            />
          </label>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="ghost" className="flex-1" onClick={() => settle(needsInput ? null : false)}>
            Cancel
          </Button>
          <Button
            variant={pending.danger ? 'danger' : 'primary'}
            className="flex-1"
            disabled={blocked}
            onClick={() => settle(needsInput ? value.trim() : true)}
          >
            {pending.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </div>
    </Sheet>
  ) : null;

  return { confirm, prompt, sheet };
}
