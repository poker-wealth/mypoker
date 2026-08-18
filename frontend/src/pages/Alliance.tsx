import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Shield, Users, Plus, Crown, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Sheet } from '@/components/ui/Sheet';
import { useMyLeagues, useDiscoverLeagues, useCreateLeague, useJoinLeague } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { useSession } from '@/store/session';
import { useContextStore } from '@/store/context';
import { toast } from '@/lib/toast';
import { haptic } from '@/lib/telegram';
import type { League } from '@/api/leagues';

/**
 * Tab 1 — Alliance.
 *
 * Two lists, deliberately separate: the ones you belong to, and the ones you
 * could join. Merging them and marking membership with a badge makes "am I in
 * this?" a thing to scan for, when it is the first question the screen should
 * answer.
 *
 * Invite-only leagues never appear in discovery — that is enforced server-side,
 * not filtered here.
 */
export function Alliance() {
  const { t } = useTranslation();
  const signedIn = useSession((s) => s.status === 'authenticated');
  const [createOpen, setCreateOpen] = useState(false);

  const mine = useMyLeagues();
  const discover = useDiscoverLeagues();
  const join = useJoinLeague();
  const navigate = useNavigate();

  const activeLeagueId = useContextStore((s) => s.leagueId);
  const enterLeague = useContextStore((s) => s.enterLeague);
  const leavePlatformContext = useContextStore((s) => s.leavePlatformContext);
  const leaveContextIfGone = useContextStore((s) => s.leaveContextIfGone);

  const myIds = new Set((mine.data?.leagues ?? []).map((l) => l.leagueId));
  const joinable = (discover.data?.leagues ?? []).filter((l) => !myIds.has(l.leagueId));

  // A context that outlived its membership shows an empty lobby with no
  // explanation. The server would refuse the league anyway; this makes the
  // client stop asking.
  useEffect(() => {
    if (mine.isSuccess) leaveContextIfGone(mine.data.leagues.map((l) => l.leagueId));
  }, [mine.isSuccess, mine.data, leaveContextIfGone]);

  return (
    <div className="space-y-4">
      {/* Mine */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
          {t('alliance.mine')}
        </h2>

        {!signedIn && (
          <div className="rounded-(--radius-app) border border-border bg-surface">
            <EmptyState icon={Shield} title={t('alliance.signInToJoin')} />
          </div>
        )}

        {signedIn && mine.isPending && <Skeleton className="h-24 w-full rounded-(--radius-app)" />}

        {signedIn && mine.isError && (
          <div className="rounded-(--radius-app) border border-border bg-surface">
            <ErrorState message={t(errorKey(mine.error))} onRetry={() => void mine.refetch()} />
          </div>
        )}

        {signedIn && mine.isSuccess && mine.data.leagues.length === 0 && (
          <div className="rounded-(--radius-app) border border-border bg-surface">
            <EmptyState
              icon={Shield}
              title={t('alliance.noneYet')}
              description={t('alliance.noneYetBlurb')}
            />
          </div>
        )}

        {signedIn && mine.isSuccess && mine.data.leagues.length > 0 && (
          <div className="space-y-2">
            {mine.data.leagues.map((l) => (
              <LeagueCard
                key={l.leagueId}
                league={l}
                mine
                action={
                  activeLeagueId === l.leagueId ? (
                    <Button variant="ghost" onClick={() => leavePlatformContext()}>
                      {t('context.exit')}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => {
                        haptic('light');
                        enterLeague(l.leagueId, l.name);
                        // Straight to the room: entering an alliance and staying
                        // on a list of alliances makes the switch feel like it
                        // did not happen.
                        navigate('/lobby');
                      }}
                    >
                      {t('context.enter')}
                    </Button>
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Discover */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
          {t('alliance.discover')}
        </h2>

        {discover.isPending && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-(--radius-app)" />
            ))}
          </div>
        )}

        {discover.isError && (
          <div className="rounded-(--radius-app) border border-border bg-surface">
            <ErrorState
              message={t(errorKey(discover.error))}
              onRetry={() => void discover.refetch()}
            />
          </div>
        )}

        {discover.isSuccess && joinable.length === 0 && (
          <div className="rounded-(--radius-app) border border-border bg-surface">
            <EmptyState icon={Users} title={t('alliance.nothingToJoin')} />
          </div>
        )}

        {joinable.map((l) => (
          <div key={l.leagueId} className="mb-2">
            <LeagueCard
              league={l}
              action={
                signedIn ? (
                  <Button
                    variant="ghost"
                    disabled={join.isPending}
                    onClick={() => {
                      haptic('light');
                      join.mutate(l.leagueId, {
                        onSuccess: () => toast.success(t('alliance.joined', { name: l.name })),
                        onError: (e) =>
                          toast.error(e instanceof Error ? e.message : t('states.error')),
                      });
                    }}
                  >
                    {t('alliance.join')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ))}
      </section>

      {signedIn && (
        <Button full variant="ghost" onClick={() => setCreateOpen(true)}>
          <Plus size={16} className="mr-1.5" />
          {t('alliance.create')}
        </Button>
      )}

      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function LeagueCard({
  league,
  mine,
  action,
}: {
  league: League;
  mine?: boolean;
  action?: React.ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 rounded-(--radius-app) border border-border bg-surface p-4">
      <div
        className="grid size-11 shrink-0 place-items-center rounded-xl text-white"
        style={{ backgroundImage: 'var(--brand-gradient)' }}
      >
        <Shield size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{league.name}</span>
          {mine && <Crown size={13} className="shrink-0 text-jackpot" />}
          {league.inviteOnly && <Lock size={12} className="shrink-0 text-dim" />}
        </div>
        <div className="truncate text-[0.66rem] text-dim">
          {t('alliance.members', { count: league.memberCount })}
          {league.description ? ` · ${league.description}` : ''}
        </div>
      </div>
      {action}
    </div>
  );
}

function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [inviteOnly, setInviteOnly] = useState(false);
  const create = useCreateLeague();

  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;

    // The id is derived from the name rather than asked for. A player naming
    // their alliance should not also have to invent a URL-safe identifier, and
    // the random suffix keeps two "Dragon Alliance"s from colliding.
    const slug = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24);
    const leagueId = `${slug || 'league'}-${Math.random().toString(36).slice(2, 8)}`;

    create.mutate(
      { leagueId, name: trimmed, inviteOnly },
      {
        onSuccess: () => {
          toast.success(t('alliance.created', { name: trimmed }));
          setName('');
          setInviteOnly(false);
          onClose();
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : t('states.error')),
      },
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('alliance.create')}>
      <div className="space-y-3 p-4">
        <div>
          <label htmlFor="league-name" className="text-xs font-semibold text-dim">
            {t('alliance.name')}
          </label>
          <input
            id="league-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder={t('alliance.namePlaceholder')}
            className="mt-1 w-full rounded-(--radius-app) border border-border bg-surface px-3 py-2.5 text-sm text-text placeholder:text-dim"
          />
        </div>

        <label className="flex items-center justify-between rounded-(--radius-app) border border-border bg-surface px-4 py-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium">{t('alliance.inviteOnly')}</span>
            <span className="block text-[0.66rem] text-dim">{t('alliance.inviteOnlyBlurb')}</span>
          </span>
          <input
            type="checkbox"
            checked={inviteOnly}
            onChange={(e) => setInviteOnly(e.target.checked)}
            className="size-4 shrink-0 accent-[var(--brand)]"
          />
        </label>

        <Button full disabled={name.trim().length < 2 || create.isPending} onClick={submit}>
          {create.isPending ? t('common.loading') : t('alliance.create')}
        </Button>
      </div>
    </Sheet>
  );
}
