import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { api, ApiError } from '../api';
import { moneyFromDecimal } from '../money';
import { radius, space, theme, weight } from '../theme';
import { Badge, Button, Card, ErrorState, Sheet, Skeleton } from '../ui';
import { SecurityBanner } from '../SecurityBanner';

/**
 * Wallet — the app's entire money-movement screen. Ported from
 * `frontend/src/pages/Wallet.tsx` to close the gap the original 85-line
 * balance-only version left: on a real-money app the player could see a
 * number but could not deposit, withdraw, register a payout address, or see
 * a transaction, despite ProfileScreen's "Wallet" row promising exactly that.
 *
 * Every figure below is a DECIMAL STRING from financial-core (see
 * `frontend/src/api/wallet.ts`) — never a float, never client-summed. Loading
 * shows a `Skeleton`, failure shows the reason and a retry, and a figure is
 * rendered only once the server actually sent one: a zero here would be a
 * claim, not an absence.
 *
 * No toast system exists on this app (see AgentCenterScreen). The web's
 * success toasts become inline confirmation text next to the control that
 * caused them; its icons become tinted text, since this app has no icon
 * library for content.
 */

interface Balance {
  /** Spendable. Decimal string. */
  available: string;
  /** Committed to a live table buy-in. Decimal string. */
  locked: string;
  /** available + locked + clearing, summed server-side. Decimal string. */
  total: string;
}

interface DepositAddress {
  configured: boolean;
  address?: string;
}

interface WalletTxn {
  at: string;
  type: string;
  direction: 'DEBIT' | 'CREDIT';
  /** Decimal string. */
  amount: string;
}

type WithdrawalState = 'REQUESTED' | 'APPROVED' | 'BROADCAST' | 'CONFIRMED' | 'REJECTED';

interface Withdrawal {
  id: string;
  /** Decimal string. */
  amount: string;
  state: WithdrawalState;
  at: string;
}

/**
 * The registered withdrawal address (§3.6). Withdrawals may only go to this
 * address, and changing it opens a 48h cooldown — `withdrawableAt` is when
 * the address on file becomes usable.
 */
interface WithdrawalAddress {
  configured: boolean;
  address?: string;
  withdrawableAt?: string;
}

/** DEPOSIT/WITHDRAW/BET/WIN_PAYOUT/RAKE/JACKPOT_PAYOUT → a short readable
 *  label. Hardcoded to match `frontend/src/pages/Wallet.tsx`'s own TXN_LABEL
 *  exactly — the web does not route these through i18n either, so there is
 *  no key to reuse here. */
const TXN_LABEL: Record<string, string> = {
  DEPOSIT: 'Deposit',
  WITHDRAW: 'Withdrawal',
  BET: 'Bet',
  WIN_PAYOUT: 'Win',
  RAKE: 'Rake',
  JACKPOT_PAYOUT: 'Jackpot',
};

// Mirrors financial-core's own decimal check exactly (`Money.fromDecimalString`,
// `financial-core/src/domain/money.ts`: `^(-?)(\d+)(?:\.(\d+))?$` plus a
// 6-place scale check) — minus the leading-sign group, since a withdrawal
// amount must be positive. A bare, non-negative decimal string with at most
// 6 fractional digits. No leading `+`, no scientific notation, no trailing
// dot, no locale decimal comma (which `decimal-pad` produces on some Android
// locales) — every one of those 400s server-side today and used to come back
// mislabelled as an invalid ADDRESS (see submit() below).
//
// Deliberately NOT `Number()`/`parseFloat`: this project's iron rule is that
// no float ever touches a money value, even to validate one — a string
// check is both sufficient and correct here.
const DECIMAL_AMOUNT_RE = /^(\d+)(?:\.(\d+))?$/;

/** True for a positive decimal string financial-core will accept as a
 *  withdrawal amount. Rejects empty, zero, negative, `+`-prefixed,
 *  scientific notation, a trailing dot, more than 6 fractional digits, and
 *  a locale decimal comma. */
function isValidWithdrawAmount(raw: string): boolean {
  const match = DECIMAL_AMOUNT_RE.exec(raw);
  if (!match) return false;
  const whole = match[1];
  const frac = match[2] ?? '';
  if (frac.length > 6) return false;
  // Zero and "0.00...0" are syntactically valid decimals but not a
  // withdrawable amount — true only if some digit is non-zero.
  return /[1-9]/.test(whole + frac);
}

export function WalletScreen() {
  const { t } = useTranslation();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const balance = useQuery({
    queryKey: ['wallet', 'balance'],
    queryFn: () => api.get<Balance>('/me/balance'),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });

  const txns = useQuery({
    queryKey: ['wallet', 'transactions'],
    queryFn: () => api.get<{ transactions: WalletTxn[] }>('/me/transactions?limit=50'),
    staleTime: 10_000,
    retry: 1,
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Above the balance, not below it: this is the screen money leaves
          from, so the warning has to be read before the number, not after. */}
      <SecurityBanner />

      {/* Balance */}
      <View style={styles.balanceCard}>
        <LinearGradient
          colors={[theme.brand, theme.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.balanceLabel}>{t('wallet.totalBalance')}</Text>

        {balance.isPending && <Skeleton width={160} />}

        {balance.isError && (
          <ErrorState
            message={balance.error instanceof Error ? balance.error.message : t('states.error')}
            onRetry={() => void balance.refetch()}
            retryLabel={t('common.retry')}
          />
        )}

        {balance.isSuccess && (
          <>
            <Text style={styles.balanceAmount}>{moneyFromDecimal(balance.data.total)}</Text>
            <View style={styles.splitRow}>
              <View style={styles.splitCell}>
                <Text style={styles.splitLabel}>{t('wallet.available')}</Text>
                <Text style={styles.splitValue}>{moneyFromDecimal(balance.data.available)}</Text>
              </View>
              <View style={styles.splitCell}>
                <Text style={styles.splitLabel}>{t('wallet.inPlay')}</Text>
                <Text style={styles.splitValue}>{moneyFromDecimal(balance.data.locked)}</Text>
              </View>
            </View>
          </>
        )}
      </View>

      {/* Actions */}
      <View style={styles.actionRow}>
        <View style={styles.flex}>
          <Button onPress={() => setDepositOpen(true)}>{t('wallet.deposit')}</Button>
        </View>
        <View style={styles.flex}>
          <Button variant="ghost" onPress={() => setWithdrawOpen(true)}>
            {t('wallet.withdraw')}
          </Button>
        </View>
      </View>

      {/* Testnet notice */}
      <View style={styles.testnetCard}>
        <Text style={styles.testnetText}>
          <Trans i18nKey="wallet.testnetNotice">
            <Text style={styles.testnetStrong} />
          </Trans>
        </Text>
      </View>

      {/* Activity */}
      <View style={styles.stack}>
        <Text style={styles.sectionTitle}>{t('wallet.recentActivity')}</Text>
        <Card style={styles.listCard}>
          {txns.isPending &&
            [0, 1, 2].map((i) => (
              <View key={i} style={styles.txnRow}>
                <Skeleton width={100} />
                <Skeleton width={56} />
              </View>
            ))}

          {txns.isError && (
            <ErrorState
              message={txns.error instanceof Error ? txns.error.message : t('states.error')}
              onRetry={() => void txns.refetch()}
              retryLabel={t('common.retry')}
            />
          )}

          {txns.isSuccess && txns.data.transactions.length === 0 && (
            <View style={styles.emptyTxn}>
              <Text style={styles.emptyTitle}>{t('wallet.noTransactions')}</Text>
              <Text style={styles.emptyBody}>{t('wallet.noTransactionsBlurb')}</Text>
            </View>
          )}

          {txns.isSuccess &&
            txns.data.transactions.map((tx, i) => {
              const credit = tx.direction === 'CREDIT';
              return (
                <View key={`${tx.at}-${i}`} style={styles.txnRow}>
                  <View style={styles.txnMain}>
                    <Text style={styles.txnLabel}>{TXN_LABEL[tx.type] ?? tx.type}</Text>
                    <Text style={styles.txnDate}>{new Date(tx.at).toLocaleString()}</Text>
                  </View>
                  <Text style={[styles.txnAmount, credit && styles.txnCredit]}>
                    {credit ? '+' : '−'}
                    {moneyFromDecimal(tx.amount)}
                  </Text>
                </View>
              );
            })}
        </Card>
      </View>

      <DepositSheet open={depositOpen} onClose={() => setDepositOpen(false)} />
      <WithdrawSheet
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        // null means "the server has not said" — still loading, or the query
        // failed. A withdrawal form is the last place a zero should stand in
        // for that: WithdrawSheet below shows a Skeleton or an em dash
        // instead of ever printing a fabricated ₮0 balance.
        available={balance.isSuccess ? balance.data.available : null}
        availableLoading={balance.isPending}
      />
    </ScrollView>
  );
}

// ── Deposit ─────────────────────────────────────────────────────────────────

function DepositSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  // Fetched unconditionally, same as the web's useDepositAddress — the
  // address is permanent per player, so it is worth having cached before the
  // sheet is even opened rather than paying a round trip on first tap.
  const deposit = useQuery({
    queryKey: ['wallet', 'deposit-address'],
    queryFn: () => api.get<DepositAddress>('/me/deposit-address'),
    staleTime: Infinity,
    retry: 1,
  });

  const copy = async (address: string): Promise<void> => {
    try {
      await Clipboard.setStringAsync(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No toast system, and no dedicated failure copy for this on mobile —
      // the button simply does not confirm, which is honest about what
      // happened without inventing a string.
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('wallet.depositTitle')}>
      {deposit.isPending && <Skeleton width={220} />}

      {deposit.isError && (
        <ErrorState
          message={deposit.error instanceof Error ? deposit.error.message : t('states.error')}
          onRetry={() => void deposit.refetch()}
          retryLabel={t('common.retry')}
        />
      )}

      {deposit.isSuccess && (!deposit.data.configured || !deposit.data.address) && (
        <View style={styles.notConfigured}>
          <Text style={styles.notConfiguredText}>{t('wallet.depositNotConfigured')}</Text>
        </View>
      )}

      {deposit.isSuccess && deposit.data.configured && deposit.data.address && (
        <>
          <Text style={styles.fieldLabel}>{t('wallet.depositAddressLabel')}</Text>
          <View style={styles.addressBox}>
            <Text style={styles.addressBoxText}>{deposit.data.address}</Text>
          </View>
          <Button onPress={() => void copy(deposit.data.address!)}>
            {copied ? t('wallet.addressCopied') : t('wallet.copyAddress')}
          </Button>
          <Text style={styles.networkLine}>{t('wallet.depositNetwork')}</Text>
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>{t('wallet.depositWarn')}</Text>
          </View>
        </>
      )}
    </Sheet>
  );
}

// ── Withdraw ────────────────────────────────────────────────────────────────

function WithdrawSheet({
  open,
  onClose,
  available,
  availableLoading,
}: {
  open: boolean;
  onClose: () => void;
  /** Decimal string, or null when the server has not said (query failed). */
  available: string | null;
  /** True while the balance query's first fetch is still in flight. */
  availableLoading: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const withdrawals = useQuery({
    queryKey: ['wallet', 'withdrawals'],
    queryFn: () => api.get<{ withdrawals: Withdrawal[] }>('/me/withdrawals?limit=50'),
    staleTime: 10_000,
    retry: 1,
  });

  // §3.6: withdrawals go ONLY to the registered address, and only once its
  // 48h cooldown has elapsed. Both facts have to be on screen before the
  // player types an amount — financial-core refuses otherwise, and a form
  // that does not know this can only produce a 403 with nothing the player
  // can act on.
  const registered = useQuery({
    queryKey: ['wallet', 'withdrawal-address'],
    queryFn: () => api.get<WithdrawalAddress>('/me/withdrawal-address'),
    retry: 1,
  });

  const invalidateWallet = (): void => void queryClient.invalidateQueries({ queryKey: ['wallet'] });

  const saveAddress = useMutation({
    mutationFn: (address: string) => api.post<WithdrawalAddress>('/me/withdrawal-address', { address }),
    onSuccess: invalidateWallet,
  });

  const withdraw = useMutation({
    mutationFn: (body: { amount: string; address: string }) =>
      api.post<{ withdrawalId: string; state: WithdrawalState }>('/me/withdrawals', body),
    // A request doesn't move the balance yet (risk review first), but it
    // must appear in the withdrawals list immediately.
    onSuccess: invalidateWallet,
  });

  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [changing, setChanging] = useState(false);
  const [addressMsg, setAddressMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [withdrawMsg, setWithdrawMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Synchronous double-submit guards. `mutation.isPending` is React state —
  // it only flips true on the NEXT render, so two taps landing in the same
  // frame both read it as false and both call mutate(). A `ref` is not
  // state: it is readable/writable synchronously, mid-event-handler, so the
  // second tap sees the flag the first one just set. On a withdrawal form
  // that render-cycle gap is the difference between one request and two.
  const withdrawGuard = useRef(false);
  const addressGuard = useRef(false);

  const reg = registered.data;
  const openAt = reg?.withdrawableAt ? new Date(reg.withdrawableAt) : null;
  const inCooldown = openAt !== null && openAt.getTime() > Date.now();
  const canWithdraw = Boolean(reg?.configured) && !inCooldown;
  const needsAddress = !reg?.configured || changing;

  const submitAddress = (): void => {
    // Guard first, synchronously, before any of the checks below run — a
    // second tap arriving before this function returns must bail here, not
    // fall through and fire a second POST.
    if (addressGuard.current) return;
    const next = address.trim();
    if (!next) return;
    addressGuard.current = true;
    setAddressMsg(null);
    saveAddress.mutate(next, {
      onSettled: () => {
        addressGuard.current = false;
      },
      onSuccess: () => {
        setAddressMsg({ ok: true, text: t('wallet.addressSaved') });
        setAddress('');
        setChanging(false);
      },
      onError: (e) =>
        setAddressMsg({
          ok: false,
          text: e instanceof ApiError && e.status === 400 ? t('wallet.invalidAddress') : t('wallet.addressFailed'),
        }),
    });
  };

  const submit = (): void => {
    // Same synchronous guard as submitAddress — see the comment on
    // withdrawGuard above. This is the higher-stakes one: two taps here are
    // two genuine withdrawal requests, each individually valid, both
    // landing in the ops approval queue. The ledger's own idempotency key
    // (withdrawal-state-machine.ts) only stops one being PAID twice; it
    // never sees this race because each POST mints a fresh withdrawal id.
    if (withdrawGuard.current) return;
    if (!amount.trim() || !reg?.address) return;

    const trimmed = amount.trim();
    // Validate client-side before this ever reaches the server. The server
    // 400s on the same family of bad amounts (non-numeric, scientific
    // notation, a leading '+', a trailing dot, a locale decimal comma, >6
    // decimal places, negative or zero) and until now that 400 was always
    // read back as "invalid address" below — telling someone who mistyped
    // an amount that their (non-editable) address is the problem.
    if (!isValidWithdrawAmount(trimmed)) {
      setWithdrawMsg({ ok: false, text: t('wallet.withdrawFailed') });
      return;
    }

    withdrawGuard.current = true;
    setWithdrawMsg(null);
    withdraw.mutate(
      // The address is the REGISTERED one, never a typed one — sending
      // anything else is refused, and offering a free-text field would
      // invite exactly the mistake the rule exists to prevent. The amount
      // travels as the same trimmed string the input held, exactly as
      // before — only now it has been checked, never parsed to a float.
      { amount: trimmed, address: reg.address },
      {
        onSettled: () => {
          withdrawGuard.current = false;
        },
        onSuccess: () => {
          setWithdrawMsg({ ok: true, text: t('wallet.withdrawRequested') });
          setAmount('');
        },
        onError: (e) => {
          // 403 is the §3.6 refusal (no address, or still in cooldown) and it
          // carries a message worth showing verbatim — it names the moment
          // withdrawals open. Any remaining 400 is no longer asserted to be
          // the address: the client-side check above already caught the
          // amount problems that used to land here, so what's left is
          // whatever else the server refused — call it what it is, a failed
          // withdrawal, rather than guessing which field was wrong.
          const msg =
            e instanceof ApiError && e.status === 403
              ? e.message
              : e instanceof ApiError && e.status === 409
                ? t('wallet.insufficient')
                : t('wallet.withdrawFailed');
          setWithdrawMsg({ ok: false, text: msg });
        },
      },
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('wallet.withdrawTitle')}>
      {/* Never a fabricated ₮0: while the balance query is loading this shows
          the same Skeleton affordance the balance card above uses, and if it
          failed (available === null but not loading), the amount slot reads
          "—" rather than a computed figure — same rule as the balance card,
          just expressed inline since this is one line of translated text. */}
      {availableLoading ? (
        <Skeleton width={140} />
      ) : (
        <Text style={styles.dim}>
          {t('wallet.availableToWithdraw', {
            amount: available !== null ? moneyFromDecimal(available) : '—',
          })}
        </Text>
      )}

      <View>
        <Text style={styles.fieldLabel}>{t('wallet.amountLabel')}</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.000000"
          placeholderTextColor={theme.dim}
          style={styles.input}
        />
      </View>

      {/* The registered address (§3.6). Either register one, or see the one
          on file — never a free-text field, because anything else is
          refused and offering the box invites the mistake the rule exists
          to stop. Loading is its own state rather than falling through to
          "register one": while the read is in flight, an address may
          already be on file. */}
      {registered.isPending && <Skeleton width={200} />}

      {registered.isSuccess && needsAddress && (
        <View style={styles.stackSm}>
          <Text style={styles.fieldLabel}>{t('wallet.addressLabel')}</Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="T…"
            placeholderTextColor={theme.dim}
            autoCapitalize="none"
            style={styles.input}
          />
          <Text style={styles.note}>{t('wallet.addressCooldownNote')}</Text>
          {addressMsg && (
            <Text style={addressMsg.ok ? styles.confirmOk : styles.confirmErr}>{addressMsg.text}</Text>
          )}
          <View style={styles.actionRow}>
            <View style={styles.flex}>
              <Button disabled={saveAddress.isPending || !address.trim()} onPress={submitAddress}>
                {saveAddress.isPending ? t('common.loading') : t('wallet.saveAddress')}
              </Button>
            </View>
            {changing && (
              <View style={styles.flex}>
                <Button
                  variant="ghost"
                  onPress={() => {
                    setChanging(false);
                    setAddress('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </View>
            )}
          </View>
        </View>
      )}

      {registered.isSuccess && !needsAddress && (
        <View style={styles.addressCard}>
          <View style={styles.addressCardHead}>
            <Text style={styles.fieldLabel}>{t('wallet.addressLabel')}</Text>
            <Pressable onPress={() => setChanging(true)} hitSlop={8}>
              <Text style={styles.changeLink}>{t('wallet.changeAddress')}</Text>
            </Pressable>
          </View>
          <Text style={styles.addressCardValue} numberOfLines={1}>
            {reg?.address}
          </Text>
          {inCooldown && openAt && (
            <Text style={styles.lockedText}>
              {t('wallet.addressLocked', { when: openAt.toLocaleString() })}
            </Text>
          )}
        </View>
      )}

      {registered.isError && (
        <ErrorState
          message={registered.error instanceof Error ? registered.error.message : t('states.error')}
          onRetry={() => void registered.refetch()}
          retryLabel={t('common.retry')}
        />
      )}

      <Button disabled={withdraw.isPending || !amount.trim() || !canWithdraw} onPress={submit}>
        {withdraw.isPending ? t('common.loading') : t('wallet.submitWithdraw')}
      </Button>

      {withdrawMsg && (
        <Text style={withdrawMsg.ok ? styles.confirmOk : styles.confirmErr}>{withdrawMsg.text}</Text>
      )}

      {/* Status list. A failed query and "never withdrawn" must never look
          the same — this is the money screen, so silence here reads as
          reassurance ("nothing to see") when it may mean the list is
          simply broken. Loading gets its own Skeleton state and a failure
          gets the reason plus retry, same pattern the rest of this file
          already uses for balance/transactions/registered-address. A
          genuinely empty list (isSuccess, zero rows) still renders nothing
          below — that is an honest "no withdrawals yet", not a broken one. */}
      {withdrawals.isPending && (
        <View style={styles.stackSm}>
          <Text style={styles.sectionTitleSm}>{t('wallet.withdrawalsTitle')}</Text>
          <Card style={styles.listCard}>
            {[0, 1].map((i) => (
              <View key={i} style={styles.wdRow}>
                <Skeleton width={100} />
                <Skeleton width={56} />
              </View>
            ))}
          </Card>
        </View>
      )}

      {withdrawals.isError && (
        <View style={styles.stackSm}>
          <Text style={styles.sectionTitleSm}>{t('wallet.withdrawalsTitle')}</Text>
          <ErrorState
            message={withdrawals.error instanceof Error ? withdrawals.error.message : t('states.error')}
            onRetry={() => void withdrawals.refetch()}
            retryLabel={t('common.retry')}
          />
        </View>
      )}

      {withdrawals.isSuccess && withdrawals.data.withdrawals.length > 0 && (
        <View style={styles.stackSm}>
          <Text style={styles.sectionTitleSm}>{t('wallet.withdrawalsTitle')}</Text>
          <Card style={styles.listCard}>
            {withdrawals.data.withdrawals.slice(0, 5).map((w) => (
              <View key={w.id} style={styles.wdRow}>
                <View>
                  <Text style={styles.wdAmount}>{moneyFromDecimal(w.amount)}</Text>
                  <Text style={styles.wdDate}>{new Date(w.at).toLocaleString()}</Text>
                </View>
                <Badge tone="brand">{w.state}</Badge>
              </View>
            ))}
          </Card>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: space.lg, gap: space.md },
  stack: { gap: space.sm },
  stackSm: { gap: space.xs },
  flex: { flex: 1 },
  dim: { color: theme.dim, fontSize: 11, fontFamily: weight('400') },

  balanceCard: {
    borderRadius: radius.card,
    overflow: 'hidden',
    padding: space.lg,
    gap: 4,
  },
  balanceLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: weight('700'),
  },
  balanceAmount: { color: '#ffffff', fontSize: 34, fontFamily: weight('900') },
  splitRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  splitCell: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: radius.card - 4,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    gap: 2,
  },
  splitLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontFamily: weight('400') },
  splitValue: { color: '#ffffff', fontSize: 14, fontFamily: weight('800') },

  actionRow: { flexDirection: 'row', gap: space.sm },

  testnetCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.25)',
    backgroundColor: 'rgba(0,212,255,0.06)',
    padding: space.md,
  },
  testnetText: { color: theme.dim, fontSize: 11, lineHeight: 16, fontFamily: weight('400') },
  testnetStrong: { color: theme.text, fontFamily: weight('700') },

  sectionTitle: { color: theme.dim, fontSize: 12, fontFamily: weight('700') },
  sectionTitleSm: { color: theme.dim, fontSize: 11, textTransform: 'uppercase', fontFamily: weight('800') },
  listCard: { padding: 0, paddingHorizontal: space.md, gap: 0 },

  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  txnMain: { gap: 1 },
  txnLabel: { color: theme.text, fontSize: 13, fontFamily: weight('700') },
  txnDate: { color: theme.dim, fontSize: 10, fontFamily: weight('400') },
  txnAmount: { color: theme.text, fontSize: 13, fontFamily: weight('800') },
  txnCredit: { color: theme.success },

  emptyTxn: { alignItems: 'center', gap: 4, paddingVertical: space.lg },
  emptyTitle: { color: theme.text, fontSize: 13, fontFamily: weight('700') },
  emptyBody: { color: theme.dim, fontSize: 11, fontFamily: weight('400') },

  fieldLabel: { color: theme.dim, fontSize: 11, fontFamily: weight('700') },
  input: {
    marginTop: 4,
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: theme.text,
    fontSize: 14,
    fontFamily: weight('400'),
  },

  notConfigured: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingVertical: space.xl,
    alignItems: 'center',
  },
  notConfiguredText: { color: theme.dim, fontSize: 12, fontFamily: weight('400') },

  addressBox: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: space.md,
  },
  addressBoxText: { color: theme.text, fontSize: 13, fontFamily: weight('400') },
  networkLine: { color: theme.dim, fontSize: 11, fontFamily: weight('400') },
  warnBox: {
    flexDirection: 'row',
    gap: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(248,86,119,0.25)',
    backgroundColor: 'rgba(248,86,119,0.08)',
    padding: space.sm,
  },
  warnText: { flex: 1, color: theme.dim, fontSize: 11, lineHeight: 16, fontFamily: weight('400') },

  note: { color: theme.dim, fontSize: 10, lineHeight: 15, fontFamily: weight('400') },
  confirmOk: { color: theme.success, fontSize: 11, fontFamily: weight('700') },
  confirmErr: { color: theme.danger, fontSize: 11, fontFamily: weight('700') },

  addressCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: space.sm,
    gap: 4,
  },
  addressCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  changeLink: { color: theme.brand, fontSize: 11, fontFamily: weight('700') },
  addressCardValue: { color: theme.text, fontSize: 13, fontFamily: weight('400') },
  lockedText: { color: theme.danger, fontSize: 10, fontFamily: weight('400') },

  wdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  wdAmount: { color: theme.text, fontSize: 13, fontFamily: weight('800') },
  wdDate: { color: theme.dim, fontSize: 10, fontFamily: weight('400') },
});
