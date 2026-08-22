import { type ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../api';
import { radius, space, theme, weight } from '../theme';
import { Badge, Button, Card, EmptyState, ErrorState, ListRow, Screen, Sheet, Toggle } from '../ui';

/**
 * Alliance — leagues you belong to, and leagues you could join. Ported from
 * frontend/src/pages/Alliance.tsx.
 *
 * Two lists, deliberately separate, same as the web original: merging them
 * and badging membership makes "am I in this?" a thing to scan for.
 *
 * Left out, deliberately:
 *
 *   Enter/Exit (platform vs. league context) and "New table" — both depend on
 *   a league-context store (`useContextStore`) and CreateTableSheet, neither
 *   of which exist in this shell. TableScreen here is opened directly with a
 *   tableId; there is no lobby-context concept to switch yet.
 *
 *   Sign-in gating on "Your alliances" — no reactive session store exists
 *   (see ProfileScreen). Same as every other ported screen, this just asks
 *   the server; an unauthenticated request comes back as an ordinary error
 *   with the server's own message, through the same ErrorState everything
 *   else uses.
 *
 *   Toast confirmations on join/create — there is no toast system in this
 *   app yet. Success is the list updating; failure is shown inline instead.
 *
 * The create flow uses `Sheet`. Dismissing it by the backdrop only calls
 * `onClose` — there is no path from a backdrop tap to `create.mutate`.
 */

interface League {
  leagueId: string;
  name: string;
  description: string | null;
  inviteOnly: boolean;
  memberCount: number;
}

export function AllianceScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const mine = useQuery({
    queryKey: ['leagues', 'mine'],
    queryFn: () => api.get<{ leagues: League[] }>('/me/leagues'),
    staleTime: 30_000,
    retry: 1,
  });

  // Public — browsing alliances should not need an account.
  const discover = useQuery({
    queryKey: ['leagues', 'discover'],
    queryFn: () => api.get<{ leagues: League[] }>('/leagues'),
    staleTime: 30_000,
    retry: 1,
  });

  const join = useMutation({
    mutationFn: (leagueId: string) => api.post<League>(`/leagues/${encodeURIComponent(leagueId)}/join`),
    onSuccess: () => {
      setJoiningId(null);
      void queryClient.invalidateQueries({ queryKey: ['leagues'] });
    },
    onError: () => setJoiningId(null),
  });

  const myIds = new Set((mine.data?.leagues ?? []).map((l) => l.leagueId));
  const joinable = (discover.data?.leagues ?? []).filter((l) => !myIds.has(l.leagueId));

  return (
    <>
      <Screen query={mine} errorLabel={{ retry: t('common.retry'), fallback: t('states.error') }}>
        {(data) => (
          <>
            <Section title={t('alliance.mine')}>
              {data.leagues.length === 0 ? (
                <Card>
                  <EmptyState title={t('alliance.noneYet')} body={t('alliance.noneYetBlurb')} />
                </Card>
              ) : (
                <View style={styles.list}>
                  {data.leagues.map((l) => (
                    <LeagueRow key={l.leagueId} league={l} />
                  ))}
                </View>
              )}
            </Section>

            <Section title={t('alliance.discover')}>
              {discover.isPending && <ActivityIndicator color={theme.brand} style={styles.pad} />}

              {discover.isError && (
                <Card>
                  <ErrorState
                    message={discover.error instanceof Error ? discover.error.message : t('states.error')}
                    onRetry={() => void discover.refetch()}
                    retryLabel={t('common.retry')}
                  />
                </Card>
              )}

              {discover.isSuccess && joinable.length === 0 && (
                <Card>
                  <EmptyState title={t('alliance.nothingToJoin')} />
                </Card>
              )}

              {discover.isSuccess && joinable.length > 0 && (
                <View style={styles.list}>
                  {joinable.map((l) => (
                    <LeagueRow
                      key={l.leagueId}
                      league={l}
                      action={
                        <Button
                          variant="ghost"
                          disabled={join.isPending && joiningId === l.leagueId}
                          onPress={() => {
                            setJoiningId(l.leagueId);
                            join.mutate(l.leagueId);
                          }}
                        >
                          {t('alliance.join')}
                        </Button>
                      }
                    />
                  ))}
                </View>
              )}

              {join.isError && (
                <Text style={styles.errorText}>
                  {join.error instanceof Error ? join.error.message : t('states.error')}
                </Text>
              )}
            </Section>

            <Button variant="ghost" onPress={() => setCreateOpen(true)}>
              {t('alliance.create')}
            </Button>
          </>
        )}
      </Screen>

      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function LeagueRow({ league, action }: { league: League; action?: ReactNode }) {
  const { t } = useTranslation();
  const hint =
    t('alliance.members', { count: league.memberCount }) +
    (league.description ? ` · ${league.description}` : '');

  return (
    <Card style={styles.leagueCard}>
      <ListRow
        label={league.name}
        hint={hint}
        right={
          <View style={styles.leagueRight}>
            {league.inviteOnly && <Badge tone="neutral">{t('alliance.inviteOnly')}</Badge>}
            {action}
          </View>
        }
      />
    </Card>
  );
}

function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [inviteOnly, setInviteOnly] = useState(false);

  const create = useMutation({
    mutationFn: (body: { leagueId: string; name: string; inviteOnly: boolean }) =>
      api.post<League>('/leagues', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leagues'] });
      setName('');
      setInviteOnly(false);
      onClose();
    },
  });

  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;

    // The id is derived from the name, same as the web original — a player
    // naming their alliance should not also have to invent a URL-safe id.
    const slug = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24);
    const leagueId = `${slug || 'league'}-${Math.random().toString(36).slice(2, 8)}`;

    create.mutate({ leagueId, name: trimmed, inviteOnly });
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('alliance.create')}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{t('alliance.name')}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={40}
          placeholder={t('alliance.namePlaceholder')}
          placeholderTextColor={theme.dim}
          style={styles.input}
        />
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.toggleMain}>
          <Text style={styles.toggleLabel}>{t('alliance.inviteOnly')}</Text>
          <Text style={styles.toggleHint}>{t('alliance.inviteOnlyBlurb')}</Text>
        </View>
        <Toggle value={inviteOnly} onChange={setInviteOnly} />
      </View>

      {create.isError && (
        <Text style={styles.errorText}>
          {create.error instanceof Error ? create.error.message : t('states.error')}
        </Text>
      )}

      <Button disabled={name.trim().length < 2 || create.isPending} onPress={submit}>
        {create.isPending ? t('common.loading') : t('alliance.create')}
      </Button>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  sectionTitle: { paddingHorizontal: space.xs, color: theme.dim, fontSize: 11, textTransform: 'uppercase', fontFamily: weight('800') },
  list: { gap: space.sm },
  leagueCard: { padding: 0, paddingHorizontal: space.md, gap: 0 },
  leagueRight: { alignItems: 'flex-end', gap: space.xs },
  pad: { alignSelf: 'flex-start', paddingVertical: space.sm },
  errorText: { color: theme.danger, fontSize: 12, fontFamily: weight('400') },
  field: { gap: space.xs },
  fieldLabel: { color: theme.dim, fontSize: 11, fontFamily: weight('700') },
  input: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: theme.text,
    fontSize: 14,
    backgroundColor: theme.surface, fontFamily: weight('400') },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: theme.surface,
  },
  toggleMain: { flex: 1, gap: 2, paddingRight: space.sm },
  toggleLabel: { color: theme.text, fontSize: 13, fontFamily: weight('600') },
  toggleHint: { color: theme.dim, fontSize: 11, fontFamily: weight('400') },
});
