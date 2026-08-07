import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, Link2, Network, Copy, TrendingUp, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import {
  useAgent,
  useAgentEligibility,
  useAgentPlayers,
  useAgentLinks,
  useAgentSubAgents,
  useCreateReferralLink,
} from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { useSession } from '@/store/session';
import { toast } from '@/lib/toast';
import { haptic } from '@/lib/telegram';

/**
 * Agent Center — four tabs, per spec: overview, my players, promotion tools,
 * sub-agents.
 *
 * Note what no tab shows: a player's balance. Agents get referral tracking and
 * read-only performance data, and the server has no field to leak one — see
 * financial-core/src/agent/agent-store.ts. That is deliberate and structural
 * rather than a filter applied here.
 *
 * Non-agents get the eligibility screen instead of a 404. Most players are not
 * agents, and the interesting question for them is how far off they are.
 */

type Tab = 'overview' | 'players' | 'links' | 'subAgents';

const usd = (micros: number): string =>
  (micros / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function AgentCenter() {
  const { t } = useTranslation();
  const signedIn = useSession((s) => s.status === 'authenticated');
  const [tab, setTab] = useState<Tab>('overview');

  const agent = useAgent();

  if (!signedIn) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <EmptyState icon={Users} title={t('agent.signInToSee')} />
      </div>
    );
  }

  if (agent.isPending) {
    return <Skeleton className="h-40 w-full rounded-(--radius-app)" />;
  }

  if (agent.isError) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <ErrorState message={t(errorKey(agent.error))} onRetry={() => void agent.refetch()} />
      </div>
    );
  }

  // Null rather than 404 — see the route comment in financial-core.
  if (!agent.data.agent) return <NotAnAgent />;

  const summary = agent.data.agent;

  return (
    <div className="space-y-4">
      <div className="rounded-(--radius-app) border border-border bg-surface p-5">
        <div className="text-[0.66rem] uppercase tracking-wide text-dim">
          {t('agent.totalCommission')}
        </div>
        <div className="text-2xl font-black tabular-nums text-success">
          ₮{usd(summary.totalCommission)}
        </div>
        <div className="mt-1 text-[0.66rem] text-dim">
          {t('agent.rateLine', { rate: summary.rateBps / 100 })}
        </div>
      </div>

      <Segmented
        options={[
          { value: 'overview', label: t('agent.tab.overview') },
          { value: 'players', label: t('agent.tab.players') },
          { value: 'links', label: t('agent.tab.links') },
          { value: 'subAgents', label: t('agent.tab.subAgents') },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-3">
          <Stat label={t('agent.players')} value={String(summary.playerCount)} />
          <Stat label={t('agent.subAgents')} value={String(summary.subAgentCount)} />
        </div>
      )}

      {tab === 'players' && <PlayersTab />}
      {tab === 'links' && <LinksTab />}
      {tab === 'subAgents' && <SubAgentsTab />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-(--radius-app) border border-border bg-surface px-4 py-3">
      <div className="text-lg font-black tabular-nums">{value}</div>
      <div className="mt-0.5 text-[0.66rem] text-dim">{label}</div>
    </div>
  );
}

function PlayersTab() {
  const { t } = useTranslation();
  const players = useAgentPlayers();

  if (players.isPending) return <Skeleton className="h-24 w-full rounded-(--radius-app)" />;
  if (players.isError) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <ErrorState message={t(errorKey(players.error))} onRetry={() => void players.refetch()} />
      </div>
    );
  }
  if (players.data.players.length === 0) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <EmptyState
          icon={Users}
          title={t('agent.noPlayers')}
          description={t('agent.noPlayersBlurb')}
        />
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
        {players.data.players.map((p) => (
          <li key={p.playerId} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs">{p.playerId}</div>
              <div className="truncate text-[0.66rem] text-dim tabular-nums">
                {t('agent.roundsPlayed', { count: p.rounds })}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-bold tabular-nums text-success">
                ₮{usd(p.commissionGenerated)}
              </div>
              <div className="text-[0.6rem] text-dim">{t('agent.earned')}</div>
            </div>
          </li>
        ))}
      </ul>
      {/* Said out loud, because an agent who assumes otherwise will ask. */}
      <p className="mt-2 flex items-start gap-1.5 px-1 text-[0.66rem] leading-relaxed text-dim">
        <Lock size={11} className="mt-0.5 shrink-0" />
        {t('agent.noBalancesNote')}
      </p>
    </>
  );
}

function LinksTab() {
  const { t } = useTranslation();
  const links = useAgentLinks();
  const create = useCreateReferralLink();

  const copy = (linkId: string): void => {
    haptic('light');
    const url = `https://t.me/MyPokerApp2Bot?start=${linkId}`;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success(t('agent.linkCopied')))
      .catch(() => toast.error(t('toasts.copyFailed')));
  };

  return (
    <div className="space-y-3">
      {links.isPending && <Skeleton className="h-20 w-full rounded-(--radius-app)" />}

      {links.isSuccess && links.data.links.length === 0 && (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <EmptyState icon={Link2} title={t('agent.noLinks')} description={t('agent.noLinksBlurb')} />
        </div>
      )}

      {links.isSuccess &&
        links.data.links.map((l) => (
          <div key={l.linkId} className="rounded-(--radius-app) border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold">{l.label}</span>
              <span className="shrink-0 text-[0.66rem] text-dim tabular-nums">
                {t('agent.registrations', { count: l.registrations })}
              </span>
            </div>
            <div className="mt-2 truncate rounded-lg bg-surface-2 px-2 py-1.5 font-mono text-[0.6rem] text-dim">
              {l.linkId}
            </div>
            <Button variant="ghost" className="mt-2 w-full" onClick={() => copy(l.linkId)}>
              <Copy size={14} className="mr-1.5" />
              {t('agent.copyLink')}
            </Button>
          </div>
        ))}

      <Button
        full
        variant="ghost"
        disabled={create.isPending}
        onClick={() => {
          haptic('light');
          // Named per channel, so an agent can tell Telegram traffic from
          // Twitter traffic rather than guessing which link worked.
          const label = window.prompt(t('agent.linkLabelPrompt')) ?? 'default';
          create.mutate(
            { label },
            {
              onSuccess: () => toast.success(t('agent.linkCreated')),
              onError: (e) => toast.error(e instanceof Error ? e.message : t('states.error')),
            },
          );
        }}
      >
        <Link2 size={15} className="mr-1.5" />
        {t('agent.newLink')}
      </Button>
    </div>
  );
}

function SubAgentsTab() {
  const { t } = useTranslation();
  const subs = useAgentSubAgents();

  if (subs.isPending) return <Skeleton className="h-20 w-full rounded-(--radius-app)" />;
  if (subs.isSuccess && subs.data.subAgents.length === 0) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <EmptyState
          icon={Network}
          title={t('agent.noSubAgents')}
          description={t('agent.noSubAgentsBlurb')}
        />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
      {(subs.data?.subAgents ?? []).map((s) => (
        <li key={s.agentId} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="truncate font-mono text-xs">{s.agentId}</span>
          <span className="shrink-0 text-sm font-bold tabular-nums">{s.rateBps / 100}%</span>
        </li>
      ))}
    </ul>
  );
}

/** Shown to the great majority of players, who are not agents. */
function NotAnAgent() {
  const { t } = useTranslation();
  const eligibility = useAgentEligibility();

  return (
    <div className="space-y-4">
      <div className="rounded-(--radius-app) border border-border bg-surface p-5 text-center">
        <div
          className="mx-auto grid size-12 place-items-center rounded-2xl text-white"
          style={{ backgroundImage: 'var(--brand-gradient)' }}
        >
          <TrendingUp size={22} />
        </div>
        <h1 className="mt-3 text-base font-bold">{t('agent.becomeTitle')}</h1>
        <p className="mt-1 text-xs leading-relaxed text-dim">{t('agent.becomeBlurb')}</p>
      </div>

      {eligibility.isSuccess && (
        <div className="rounded-(--radius-app) border border-border bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-dim">
              {t('agent.requirement')}
            </span>
            <span className="text-xs tabular-nums text-dim">
              {eligibility.data.reputation} / {eligibility.data.required}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-brand"
              style={{
                width: `${Math.min(100, (eligibility.data.reputation / eligibility.data.required) * 100)}%`,
              }}
            />
          </div>
          <p className="mt-2 text-[0.66rem] leading-relaxed text-dim">
            {eligibility.data.eligible ? t('agent.eligibleNote') : t('agent.notEligibleNote')}
          </p>
        </div>
      )}
    </div>
  );
}
