import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { moneyFromDecimal } from '../money';
import { space, theme, weight } from '../theme';
import { ErrorState } from '../ui';
import { SecurityBanner } from '../SecurityBanner';

/**
 * Wallet — the first screen that talked to the real gateway.
 *
 * It exists to prove the seam works end to end (SecureStore token -> API client
 * -> gateway -> financial-core) on a device. If this shows a balance on a
 * phone, the shell is real.
 *
 * The house rule this screen exists to honour: NEVER render an invented figure.
 * Loading shows a spinner, failure shows the reason and a retry, and a balance
 * appears only when the server actually sent one. A zero and a "we could not
 * ask" must never look the same — on a money screen that is the difference
 * between "you have nothing" and "we do not know".
 *
 * It was written before this app had i18n, a money formatter, or shared state
 * primitives, and kept its own English strings, its own `₮` interpolation and
 * its own error box long after each of those existed. Those are now the shared
 * ones: `available` and `locked` are DECIMAL STRINGS from financial-core, so
 * they go through moneyFromDecimal — rendering them raw printed ₮12.500000
 * where ₮12.50 was meant.
 */

interface Balance {
  /** Decimal string, e.g. '12.500000'. Never a number. */
  available: string;
  locked?: string;
}

export function WalletScreen() {
  const { t } = useTranslation();

  const q = useQuery({
    queryKey: ['wallet', 'balance'],
    queryFn: () => api.get<Balance>('/me/balance'),
    staleTime: 5_000,
    retry: 1,
  });

  return (
    <View style={styles.screen}>
      {/* Above the balance, not below it: this is the screen money leaves
          from, so the warning has to be read before the number, not after. */}
      <SecurityBanner />

      <Text style={styles.label}>{t('wallet.available')}</Text>

      {q.isPending && <ActivityIndicator color={theme.brand} style={styles.pad} />}

      {q.isError && (
        <ErrorState
          message={q.error instanceof Error ? q.error.message : t('states.error')}
          onRetry={() => void q.refetch()}
          retryLabel={t('common.retry')}
        />
      )}

      {q.isSuccess && (
        <>
          <Text style={styles.amount}>{moneyFromDecimal(q.data.available)}</Text>
          {q.data.locked !== undefined && (
            <Text style={styles.sub}>
              {moneyFromDecimal(q.data.locked)} {t('wallet.inPlay')}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: space.lg, gap: space.sm },
  label: { color: theme.dim, fontSize: 12, textTransform: 'uppercase', fontFamily: weight('700') },
  amount: { color: theme.text, fontSize: 34, fontFamily: weight('900') },
  sub: { color: theme.dim, fontSize: 13, fontFamily: weight('400') },
  pad: { alignSelf: 'flex-start', paddingVertical: space.md },
});
