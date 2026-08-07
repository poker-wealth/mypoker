import { motion } from 'motion/react';
import { ArrowDownLeft, ArrowUpRight, Gift, Info, Copy } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ListRow } from '@/components/ui/ListRow';
import { toast } from '@/lib/toast';

const QUICK = ['10', '50', '100', '500'];

/** Placeholder until the referral endpoint exists — Victor owns the wallet now. */
const REFERRAL_CODE = 'MYPOKER';

export function Wallet() {
  const { t } = useTranslation();
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
          <div className="mt-1 text-[2.4rem] font-black leading-none tabular-nums">₮0.00</div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-black/20 px-3 py-2">
              <div className="text-[0.68rem] text-white/70">{t('wallet.available')}</div>
              <div className="font-bold tabular-nums">₮0.00</div>
            </div>
            <div className="rounded-xl bg-black/20 px-3 py-2">
              <div className="text-[0.68rem] text-white/70">{t('wallet.inPlay')}</div>
              <div className="font-bold tabular-nums">₮0.00</div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button full className="flex-1">
          <ArrowDownLeft size={18} /> {t('wallet.deposit')}
        </Button>
        <Button full variant="secondary" className="flex-1">
          <ArrowUpRight size={18} /> {t('wallet.withdraw')}
        </Button>
      </div>

      {/* Quick top-up amounts */}
      <div>
        <div className="mb-2 text-xs font-semibold text-dim">{t('wallet.quickTopUp')}</div>
        <div className="grid grid-cols-4 gap-2">
          {QUICK.map((a) => (
            <motion.button
              key={a}
              whileTap={{ scale: 0.95 }}
              className="rounded-(--radius-app) border border-border bg-surface py-3 text-sm font-bold tabular-nums active:bg-surface-2"
            >
              ₮{a}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Referral */}
      <div className="flex items-center gap-3 rounded-(--radius-app) border border-border bg-surface p-4">
        <div
          className="grid size-10 shrink-0 place-items-center rounded-full text-white"
          style={{ backgroundImage: 'var(--brand-gradient)' }}
        >
          <Gift size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{t('wallet.inviteTitle')}</div>
          <div className="truncate text-xs text-dim">{t('wallet.inviteBlurb')}</div>
        </div>
        <button
          onClick={() => {
            void navigator.clipboard
              .writeText(REFERRAL_CODE)
              .then(() => toast.success(t('toasts.copied')))
              // Clipboard access is denied in some in-app webviews; say so
              // rather than leaving the tap looking like it did nothing.
              .catch(() => toast.error(t('toasts.copyFailed')));
          }}
          className="flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-brand active:scale-95"
        >
          <Copy size={13} /> {t('wallet.code')}
        </button>
      </div>

      {/* Testnet notice */}
      <div className="flex items-start gap-2 rounded-(--radius-app) border border-accent/25 bg-accent/5 px-4 py-3">
        <Info size={16} className="mt-0.5 shrink-0 text-accent" />
        <p className="text-xs text-dim">
          {/* Trans, not t(): the emphasis sits mid-sentence, and where it falls
              differs by language — Chinese puts 测试资金 in a different position. */}
          <Trans i18nKey="wallet.testnetNotice">
            <span className="font-semibold text-text" />
          </Trans>
        </p>
      </div>

      {/* Activity */}
      <div>
        <div className="mb-2 text-sm font-semibold text-dim">{t('wallet.recentActivity')}</div>
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <ListRow
            title={t('wallet.noTransactions')}
            subtitle={t('wallet.noTransactionsBlurb')}
          />
        </div>
      </div>
    </div>
  );
}
