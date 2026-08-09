import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Info, Copy, Loader2 } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import {
  useBalance,
  useDepositAddress,
  useTransactions,
  useWithdrawals,
  useWithdraw,
} from '@/api/hooks';
import { ApiError } from '@/api/client';
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
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

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
            <div className="mt-1 text-lg font-bold">₮ —</div>
          ) : (
            <div className="mt-1 text-[2.4rem] font-black leading-none tabular-nums">
              ₮{balance.data.total}
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-black/20 px-3 py-2">
              <div className="text-[0.68rem] text-white/70">{t('wallet.available')}</div>
              <div className="font-bold tabular-nums">₮{balance.data?.available ?? '0.000000'}</div>
            </div>
            <div className="rounded-xl bg-black/20 px-3 py-2">
              <div className="text-[0.68rem] text-white/70">{t('wallet.inPlay')}</div>
              <div className="font-bold tabular-nums">₮{balance.data?.locked ?? '0.000000'}</div>
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
                <div key={`${tx.at}-${i}`} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold">{TXN_LABEL[tx.type] ?? tx.type}</div>
                    <div className="text-[0.66rem] text-dim">{new Date(tx.at).toLocaleString()}</div>
                  </div>
                  <div className={`text-sm font-bold tabular-nums ${credit ? 'text-success' : 'text-text'}`}>
                    {credit ? '+' : '−'}₮{tx.amount}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <DepositSheet open={depositOpen} onClose={() => setDepositOpen(false)} />
      <WithdrawSheet
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        available={balance.data?.available ?? '0'}
      />
    </div>
  );
}

// ── Deposit ─────────────────────────────────────────────────────────────────

function DepositSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const deposit = useDepositAddress();

  const copy = (address: string): void => {
    void navigator.clipboard
      .writeText(address)
      .then(() => toast.success(t('wallet.addressCopied')))
      .catch(() => toast.error(t('toasts.copyFailed')));
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('wallet.depositTitle')}>
      <div className="space-y-4 p-4">
        {deposit.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : deposit.isError || !deposit.data.configured || !deposit.data.address ? (
          <div className="rounded-(--radius-app) border border-border bg-surface px-4 py-6 text-center text-sm text-dim">
            {t('wallet.depositNotConfigured')}
          </div>
        ) : (
          <>
            <div className="text-xs font-semibold text-dim">{t('wallet.depositAddressLabel')}</div>
            <div className="rounded-(--radius-app) border border-border bg-surface p-3">
              <div className="break-all font-mono text-sm text-text">{deposit.data.address}</div>
            </div>
            <Button full onClick={() => copy(deposit.data.address!)}>
              <Copy size={16} /> {t('wallet.copyAddress')}
            </Button>
            <div className="text-[0.7rem] text-dim">{t('wallet.depositNetwork')}</div>
            <div className="flex items-start gap-2 rounded-(--radius-app) border border-danger/25 bg-danger/5 px-3 py-2">
              <Info size={15} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-[0.72rem] text-dim">{t('wallet.depositWarn')}</p>
            </div>
          </>
        )}
      </div>
    </Sheet>
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
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');

  const submit = (): void => {
    if (!amount.trim() || !address.trim()) return;
    withdraw.mutate(
      { amount: amount.trim(), address: address.trim() },
      {
        onSuccess: () => {
          toast.success(t('wallet.withdrawRequested'));
          setAmount('');
          setAddress('');
        },
        onError: (e) => {
          // 409 = over available balance; 400 = bad address. Show the specific one.
          const msg =
            e instanceof ApiError && e.status === 409
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
          {t('wallet.availableToWithdraw', { amount: `₮${available}` })}
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

        <label className="block">
          <span className="text-xs font-semibold text-dim">{t('wallet.addressLabel')}</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="T…"
            className="mt-1 w-full rounded-(--radius-app) border border-border bg-surface px-3 py-2.5 font-mono text-sm text-text placeholder:text-dim focus:border-brand focus:outline-none"
          />
        </label>

        <Button full disabled={withdraw.isPending || !amount.trim() || !address.trim()} onClick={submit}>
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
                    <div className="text-sm font-bold tabular-nums">₮{w.amount}</div>
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
