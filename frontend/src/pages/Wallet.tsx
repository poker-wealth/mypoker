import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Info, Copy, ChevronRight, Loader2 } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { FullScreenModal } from '@/components/ui/FullScreenModal';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import {
  useBalance,
  useDepositAddress,
  useTransactions,
  useWithdrawals,
  useWithdraw,
  useWithdrawalAddress,
  useSetWithdrawalAddress,
} from '@/api/hooks';
import { ApiError } from '@/api/client';
import type { WalletTxn } from '@/api/wallet';
import { toast } from '@/lib/toast';

/** DEPOSIT/WITHDRAW/BET/WIN_PAYOUT/RAKE/JACKPOT_PAYOUT → a short readable label. */
const TXN_LABEL: Record<string, string> = {
  DEPOSIT: 'Deposit',
  WITHDRAW: 'Withdrawal',
  BET: 'Bet',
  WIN_PAYOUT: 'Win',
  RAKE: 'Rake',
  JACKPOT_PAYOUT: 'Jackpot',
};

export function Wallet() {
  const { t } = useTranslation();
  const balance = useBalance();
  const txns = useTransactions();
  // Deep link from the Me tab's DEPOSIT / WITHDRAW buttons, so those land on
  // the sheet they name rather than on the wallet's front page. Read once as
  // the initial state: re-reading would reopen the sheet every time the player
  // closed it while the query string was still in the URL.
  const [params] = useSearchParams();
  const [depositOpen, setDepositOpen] = useState(params.get('action') === 'deposit');
  const [withdrawOpen, setWithdrawOpen] = useState(params.get('action') === 'withdraw');
  // Tap a row to open its full detail. `detailOpen` is kept separate from
  // `detailTxn` so the sheet's slide-out animation still has data to render
  // while it closes (clearing the txn immediately would blank it mid-exit).
  const [detailTxn, setDetailTxn] = useState<WalletTxn | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Arriving from a notification: `?txn=<businessId>` opens that transaction's
  // detail once the list has loaded. Matched on businessId because that is what
  // the notification's own event id carries — see lib/notificationLink.ts.
  //
  // Fires ONCE (the ref), so closing the sheet does not immediately reopen it
  // while the query string is still in the URL — the same reason `action=` is
  // read as initial state above rather than watched.
  const wantedTxn = params.get('txn');
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (!wantedTxn || deepLinkHandled.current || !txns.data) return;
    deepLinkHandled.current = true;
    const match = txns.data.transactions.find((tx) => tx.businessId === wantedTxn);
    if (match) {
      setDetailTxn(match);
      setDetailOpen(true);
    } else {
      // The list is capped, so a notification older than it has nothing to
      // open. Say so — landing on the wallet with nothing happening reads as a
      // broken link.
      toast.error(t('wallet.txnNotFound'));
    }
  }, [wantedTxn, txns.data, t]);

  return (
    <div className="space-y-4">
      {/* Balance */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-5"
        style={{ boxShadow: 'var(--glow-brand)' }}
      >
        <div className="absolute inset-0" style={{ backgroundImage: 'var(--brand-gradient)', opacity: 0.9 }} />
        <div className="relative text-white">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/75">
            {t('wallet.totalBalance')}
          </div>
          {balance.isPending ? (
            <Skeleton className="mt-1 h-9 w-40 bg-white/25" />
          ) : balance.isError ? (
            <div className="mt-1 text-lg font-bold">$ —</div>
          ) : (
            <div className="mt-1 text-[2.4rem] font-black leading-none tabular-nums">
              ${balance.data.total}
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-black/20 px-3 py-2">
              <div className="text-[0.68rem] text-white/70">{t('wallet.available')}</div>
              <div className="font-bold tabular-nums">${balance.data?.available ?? '0.000000'}</div>
            </div>
            <div className="rounded-xl bg-black/20 px-3 py-2">
              <div className="text-[0.68rem] text-white/70">{t('wallet.inPlay')}</div>
              <div className="font-bold tabular-nums">${balance.data?.locked ?? '0.000000'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button full className="flex-1" onClick={() => setDepositOpen(true)}>
          <ArrowDownLeft size={18} /> {t('wallet.deposit')}
        </Button>
        <Button full variant="secondary" className="flex-1" onClick={() => setWithdrawOpen(true)}>
          <ArrowUpRight size={18} /> {t('wallet.withdraw')}
        </Button>
      </div>

      {/* Testnet notice */}
      <div className="flex items-start gap-2 rounded-(--radius-app) border border-accent/25 bg-accent/5 px-4 py-3">
        <Info size={16} className="mt-0.5 shrink-0 text-accent" />
        <p className="text-xs text-dim">
          <Trans i18nKey="wallet.testnetNotice">
            <span className="font-semibold text-text" />
          </Trans>
        </p>
      </div>

      {/* Activity */}
      <div>
        <div className="mb-2 text-sm font-semibold text-dim">{t('wallet.recentActivity')}</div>
        <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
          {txns.isPending ? (
            [0, 1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))
          ) : txns.isError ? (
            <ErrorState message={t('wallet.noTransactions')} onRetry={() => void txns.refetch()} />
          ) : txns.data.transactions.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <div className="text-sm font-semibold">{t('wallet.noTransactions')}</div>
              <div className="mt-0.5 text-xs text-dim">{t('wallet.noTransactionsBlurb')}</div>
            </div>
          ) : (
            txns.data.transactions.map((tx, i) => {
              const credit = tx.direction === 'CREDIT';
              return (
                <button
                  key={`${tx.at}-${i}`}
                  type="button"
                  onClick={() => {
                    setDetailTxn(tx);
                    setDetailOpen(true);
                  }}
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-surface-2 active:bg-surface-2"
                >
                  <div>
                    <div className="text-sm font-semibold">{TXN_LABEL[tx.type] ?? tx.type}</div>
                    <div className="text-[0.66rem] text-dim">{new Date(tx.at).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-bold tabular-nums ${credit ? 'text-success' : 'text-text'}`}>
                      {credit ? '+' : '−'}${tx.amount}
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-dim" />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
      <WithdrawSheet
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        available={balance.data?.available ?? '0'}
      />
      <TxnDetailSheet open={detailOpen} txn={detailTxn} onClose={() => setDetailOpen(false)} />
    </div>
  );
}

// ── Deposit ─────────────────────────────────────────────────────────────────

/**
 * The deposit address, full screen.
 *
 * Not a bottom sheet: an address someone is about to send real money to has to
 * be readable in one look, and the network it must be sent on has to be read
 * BEFORE the address rather than in small print under it. The drawer put a
 * 34-character string in a 13px box halfway up the screen with the wallet page
 * still bright behind it.
 *
 * Order here is deliberate — network, then address, then the warning. Sending
 * USDT on the wrong chain cannot be undone or refunded, so the chain is the
 * first thing on screen, not a footnote.
 */
function DepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const deposit = useDepositAddress();

  const copy = (address: string): void => {
    void navigator.clipboard
      .writeText(address)
      .then(() => toast.success(t('wallet.addressCopied')))
      .catch(() => toast.error(t('toasts.copyFailed')));
  };

  return (
    <FullScreenModal open={open} onClose={onClose} title={t('wallet.depositTitle')}>
      {/* Centred in the viewport rather than stacked under the header: this
          screen is one short block of content, and pinning it to the top left
          it floating in a mostly empty phone screen. min-h-full so it centres
          against the modal body, and still scrolls if the text wraps long. */}
      <div className="mx-auto flex min-h-full max-w-[520px] flex-col justify-center gap-5 p-5">
        {deposit.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : deposit.isError || !deposit.data.configured || !deposit.data.address ? (
          <div className="rounded-(--radius-app) border border-border bg-surface px-4 py-8 text-center text-sm text-dim">
            {t('wallet.depositNotConfigured')}
          </div>
        ) : (
          <>
            {/* The chain, first and unmissable. */}
            <div className="rounded-(--radius-app) border border-accent/25 bg-accent/5 px-4 py-3 text-center text-sm font-semibold text-accent">
              {t('wallet.depositNetwork')}
            </div>

            <div>
              <div className="text-xs font-semibold text-dim">
                {t('wallet.depositAddressLabel')}
              </div>
              {/* select-all so one tap takes the whole address. The characters
                  are NOT grouped for readability — spaces injected for the eye
                  become spaces in a manual copy, and a mis-pasted address is
                  the exact failure this screen exists to prevent. */}
              <div className="mt-2 rounded-(--radius-app) border border-border bg-surface p-4">
                <div className="select-all break-all text-center font-mono text-base leading-relaxed tracking-wide text-text">
                  {deposit.data.address}
                </div>
              </div>
            </div>

            <Button full onClick={() => copy(deposit.data.address!)}>
              <Copy size={16} /> {t('wallet.copyAddress')}
            </Button>

            <div className="flex items-start gap-2 rounded-(--radius-app) border border-danger/25 bg-danger/5 px-4 py-3">
              <Info size={16} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-xs leading-snug text-dim">{t('wallet.depositWarn')}</p>
            </div>
          </>
        )}
      </div>
    </FullScreenModal>
  );
}

// ── Transaction detail ───────────────────────────────────────────────────────

/** Ledger types that settle a live-table hand — their businessId is the round id. */
const GAME_TXN_TYPES = ['BET', 'WIN_PAYOUT', 'RAKE', 'JACKPOT_PAYOUT'];

function TxnDetailSheet({
  open,
  txn,
  onClose,
}: {
  open: boolean;
  txn: WalletTxn | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onClose={onClose} title={t('wallet.txnDetail.title')}>
      {/* Rendered only when a txn is selected; the sheet keeps its last txn while
          it animates closed, so this stays populated through the exit. */}
      {txn && <TxnDetailContent txn={txn} />}
    </Sheet>
  );
}

function TxnDetailContent({ txn }: { txn: WalletTxn }) {
  const { t } = useTranslation();
  const credit = txn.direction === 'CREDIT';
  const onChain = txn.type === 'DEPOSIT' || txn.type === 'WITHDRAW';
  // businessId is the on-chain tx hash for deposits/withdrawals and the round id
  // for a hand's bet/win/rake/jackpot legs — label it for what it actually is.
  const refLabel = onChain
    ? t('wallet.txnDetail.txHash')
    : GAME_TXN_TYPES.includes(txn.type)
      ? t('wallet.txnDetail.roundId')
      : t('wallet.txnDetail.reference');

  const copyRef = (value: string): void => {
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.success(t('wallet.txnDetail.referenceCopied')))
      .catch(() => toast.error(t('toasts.copyFailed')));
  };

  return (
    <div className="space-y-4 p-4">
      {/* Header — type + signed amount */}
      <div className="flex flex-col items-center gap-2 py-1">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-full ${
            credit ? 'bg-success/15 text-success' : 'bg-surface-2 text-text'
          }`}
        >
          {credit ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
        </div>
        <div className="text-sm font-semibold text-dim">{TXN_LABEL[txn.type] ?? txn.type}</div>
        <div className={`text-2xl font-black tabular-nums ${credit ? 'text-success' : 'text-text'}`}>
          {credit ? '+' : '−'}${txn.amount}
        </div>
      </div>

      {/* Facts the ledger states for certain */}
      <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
        <DetailRow label={t('wallet.txnDetail.status')} value={t('wallet.txnDetail.completed')} />
        <DetailRow label={t('wallet.txnDetail.dateTime')} value={new Date(txn.at).toLocaleString()} />
        {onChain && <DetailRow label={t('wallet.txnDetail.network')} value="TRON (TRC-20)" />}
      </div>

      {/* Reference — the on-chain tx hash or round id, in full and copyable */}
      {txn.businessId && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-dim">{refLabel}</div>
          <div className="rounded-(--radius-app) border border-border bg-surface p-3">
            <div className="break-all font-mono text-xs text-text">{txn.businessId}</div>
          </div>
          <Button full variant="secondary" onClick={() => copyRef(txn.businessId!)}>
            <Copy size={16} /> {t('wallet.txnDetail.copyReference')}
          </Button>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-xs text-dim">{label}</span>
      <span className="text-right text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

// ── Withdraw ────────────────────────────────────────────────────────────────

function WithdrawSheet({
  open,
  onClose,
  available,
}: {
  open: boolean;
  onClose: () => void;
  available: string;
}) {
  const { t } = useTranslation();
  const withdrawals = useWithdrawals();
  const withdraw = useWithdraw();
  const registered = useWithdrawalAddress();
  const saveAddress = useSetWithdrawalAddress();
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [changing, setChanging] = useState(false);

  // §3.6: withdrawals go ONLY to the registered address, and only once its 48h
  // cooldown has elapsed. Both facts have to be on screen before the player
  // types an amount — financial-core refuses otherwise, and a form that does
  // not know this can only produce a 403 with nothing the player can do.
  const reg = registered.data;
  const openAt = reg?.withdrawableAt ? new Date(reg.withdrawableAt) : null;
  const inCooldown = openAt !== null && openAt.getTime() > Date.now();
  const canWithdraw = Boolean(reg?.configured) && !inCooldown;
  const needsAddress = !reg?.configured || changing;

  const submitAddress = (): void => {
    const next = address.trim();
    if (!next) return;
    saveAddress.mutate(next, {
      onSuccess: () => {
        toast.success(t('wallet.addressSaved'));
        setAddress('');
        setChanging(false);
      },
      onError: (e) =>
        toast.error(
          e instanceof ApiError && e.status === 400
            ? t('wallet.invalidAddress')
            : t('wallet.addressFailed'),
        ),
    });
  };

  const submit = (): void => {
    if (!amount.trim() || !reg?.address) return;
    withdraw.mutate(
      // The address is the REGISTERED one, never a typed one — sending anything
      // else is refused, and offering a free-text field would invite exactly
      // the mistake the rule exists to prevent.
      { amount: amount.trim(), address: reg.address },
      {
        onSuccess: () => {
          toast.success(t('wallet.withdrawRequested'));
          setAmount('');
        },
        onError: (e) => {
          // 403 is the §3.6 refusal (no address, or still in cooldown) and it
          // carries a message worth showing verbatim — it names the moment
          // withdrawals open. It used to fall through to a generic failure.
          const msg =
            e instanceof ApiError && e.status === 403
              ? e.message
              : e instanceof ApiError && e.status === 409
                ? t('wallet.insufficient')
                : e instanceof ApiError && e.status === 400
                  ? t('wallet.invalidAddress')
                  : t('wallet.withdrawFailed');
          toast.error(msg);
        },
      },
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('wallet.withdrawTitle')}>
      <div className="space-y-3 p-4">
        <div className="text-[0.72rem] text-dim">
          {t('wallet.availableToWithdraw', { amount: `$${available}` })}
        </div>

        <label className="block">
          <span className="text-xs font-semibold text-dim">{t('wallet.amountLabel')}</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.000000"
            className="mt-1 w-full rounded-(--radius-app) border border-border bg-surface px-3 py-2.5 text-text placeholder:text-dim focus:border-brand focus:outline-none"
          />
        </label>

        {/* The registered address (§3.6). Either register one, or see the one
            on file — never a free-text field, because anything else is refused
            and offering the box invites the mistake the rule exists to stop. */}
        {needsAddress ? (
          <div className="space-y-2">
            <label className="block">
              <span className="text-xs font-semibold text-dim">{t('wallet.addressLabel')}</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="T…"
                className="mt-1 w-full rounded-(--radius-app) border border-border bg-surface px-3 py-2.5 font-mono text-sm text-text placeholder:text-dim focus:border-brand focus:outline-none"
              />
            </label>
            <p className="text-[0.68rem] leading-snug text-dim">{t('wallet.addressCooldownNote')}</p>
            <div className="flex gap-2">
              <Button full disabled={saveAddress.isPending || !address.trim()} onClick={submitAddress}>
                {saveAddress.isPending && <Loader2 size={16} className="animate-spin" />}
                {t('wallet.saveAddress')}
              </Button>
              {changing && (
                <Button full variant="secondary" onClick={() => { setChanging(false); setAddress(''); }}>
                  {t('common.cancel')}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-(--radius-app) border border-border bg-surface px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-dim">{t('wallet.addressLabel')}</span>
              <button
                type="button"
                onClick={() => setChanging(true)}
                className="text-[0.68rem] font-semibold text-brand hover:underline"
              >
                {t('wallet.changeAddress')}
              </button>
            </div>
            <div className="mt-1 truncate font-mono text-sm text-text">{reg?.address}</div>
            {inCooldown && openAt && (
              <div className="mt-1.5 text-[0.68rem] text-warn">
                {t('wallet.addressLocked', { when: openAt.toLocaleString() })}
              </div>
            )}
          </div>
        )}

        <Button
          full
          disabled={withdraw.isPending || !amount.trim() || !canWithdraw}
          onClick={submit}
        >
          {withdraw.isPending && <Loader2 size={16} className="animate-spin" />}
          {t('wallet.submitWithdraw')}
        </Button>

        {/* Status list */}
        {withdrawals.data && withdrawals.data.withdrawals.length > 0 && (
          <div className="pt-2">
            <div className="mb-1.5 text-xs font-semibold text-dim">{t('wallet.withdrawalsTitle')}</div>
            <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border">
              {withdrawals.data.withdrawals.slice(0, 5).map((w) => (
                <div key={w.id} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <div className="text-sm font-bold tabular-nums">${w.amount}</div>
                    <div className="text-[0.62rem] text-dim">{new Date(w.at).toLocaleString()}</div>
                  </div>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.62rem] font-bold text-brand">
                    {w.state}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
