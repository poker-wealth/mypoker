import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../api';
import { radius, space, theme } from '../theme';

/**
 * Wallet — the first screen that talks to the real gateway.
 *
 * It exists to prove the seam works end to end (SecureStore token -> API client
 * -> gateway -> financial-core) on a device, before any of the richer screens
 * are ported. If this shows a balance on a phone, the shell is real.
 *
 * The house rule this screen exists to honour: NEVER render an invented figure.
 * Loading shows a spinner, failure shows the reason and a retry, and a balance
 * appears only when the server actually sent one. A zero and a "we could not
 * ask" must never look the same — on a money screen that is the difference
 * between "you have nothing" and "we do not know".
 */

interface Balance {
  available: string;
  locked?: string;
}

export function WalletScreen() {
  const q = useQuery({
    queryKey: ['wallet', 'balance'],
    queryFn: () => api.get<Balance>('/me/balance'),
    staleTime: 5_000,
    retry: 1,
  });

  return (
    <View style={styles.screen}>
      <Text style={styles.label}>Available</Text>

      {q.isPending && <ActivityIndicator color={theme.brand} style={styles.pad} />}

      {q.isError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            {q.error instanceof ApiError ? q.error.message : 'Could not load your balance.'}
          </Text>
          <Pressable onPress={() => void q.refetch()} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {q.isSuccess && (
        <>
          <Text style={styles.amount}>₮{q.data.available}</Text>
          {q.data.locked !== undefined && (
            <Text style={styles.sub}>₮{q.data.locked} in play</Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: space.lg, gap: space.sm },
  label: { color: theme.dim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  amount: { color: theme.text, fontSize: 34, fontWeight: '900' },
  sub: { color: theme.dim, fontSize: 13 },
  pad: { alignSelf: 'flex-start', paddingVertical: space.md },
  errorBox: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.sm,
  },
  errorText: { color: theme.text, fontSize: 13, lineHeight: 19 },
  retry: {
    alignSelf: 'flex-start',
    backgroundColor: theme.surface2,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  retryText: { color: theme.brand, fontWeight: '700', fontSize: 13 },
});
