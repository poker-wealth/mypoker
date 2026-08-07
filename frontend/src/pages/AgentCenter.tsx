import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users,
  Link2,
  Network,
  Copy,
  TrendingUp,
  Lock,
  Download,
  Share2,
  Pencil,
  ChevronDown,
} from 'lucide-react';
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
  useCommissionBreakdown,
  useCommissionSeries,
  useSettlements,
  useSetSubAgentRate,
} from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { useSession } from '@/store/session';
import { toast } from '@/lib/toast';
import { haptic } from '@/lib/telegram';
import { money } from '@/lib/money';
import { cn } from '@/lib/cn';
import type { AgentRange, ActivityStatus, ReferredPlayer, SettlementRecord } from '@/api/agent';

/**
 * Agent Center — the four-tab dashboard of FairPlay v5.9 §13.4.
 *
 * Tabs are the spec's, in the spec's order: Commission Overview, My Players,
 * Promotion Tools, Settlement Records. Sub-agents are not a tab — they are a
 * stats block inside Tab 2 and a management list inside Tab 3, which is where
 * §13.4 puts them.
 *
 * Note what no tab shows: a player's balance. §13.6 forbids it, and the server
 * has no field to leak one (financial-core/src/agent/agent-store.ts). That is
 * structural rather than a filter applied here, which is the only way a rule
 * like that survives a refactor.
 *
 * Every period total comes from the server. A client computing its own "this
 * week" from the browser clock would give agents in different timezones
 * different totals for the same tab, and neither would reconcile against the
 * settlement records underneath it.
 */

type Tab = 'overview' | 'players' | 'promotion' | 'settlements';

const RANGES: AgentRange[] = ['today', 'week', '30d', 'all'];

const ACTIVITY_DOT: Record<ActivityStatus, string> = {
  ACTIVE: 'bg-success',
  DORMANT: 'bg-jackpot',
  CHURNED: 'bg-dim/50',
};

export function AgentCenter() {
  const { t } = useTranslation();
  const signedIn = useSession((s) => s.status === 'authenticated');
  const [tab, setTab] = useState<Tab>('overview');

  const agent = useAgent();
  // The entry card shows TODAY's commission per §13.4, not the all-time total.
  const today = useCommissionBreakdown('today');

  if (!signedIn) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <EmptyState icon={Users} title={t('agent.signInToSee')} />
      </div>
    );
  }

  if (agent.isPending) return <Skeleton className="h-40 w-full rounded-(--radius-app)" />;

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
      {/* Entry card: tier badge, today's commission, players under management. */}
      <div className="rounded-(--radius-app) border border-border bg-surface p-5">
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[0.6rem] font-black uppercase tracking-wide text-white"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          >
            {summary.parentAgentId ? t('agent.badgeSub') : t('agent.badgeAgent')}
          </span>
          <span className="text-[0.66rem] text-dim">
            {t('agent.rateLine', { rate: summary.rateBps / 100 })}
          </span>
        </div>

        <div className="mt-3 text-[0.66rem] uppercase tracking-wide text-dim">
          {t('agent.todayCommission')}
        </div>
        <div className="text-3xl font-black tabular-nums text-success">
          {today.isSuccess ? money(today.data.total) : '—'}
        </div>

        <div className="mt-2 text-[0.66rem] text-dim">
          {t('agent.playersUnderManagement', { count: summary.playerCount })}
        </div>
      </div>

      <Segmented
        options={[
          { value: 'overview', label: t('agent.tab.overview') },
          { value: 'players', label: t('agent.tab.players') },
          { value: 'promotion', label: t('agent.tab.promotion') },
          { value: 'settlements', label: t('agent.tab.settlements') },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' && <OverviewTab />}
      {tab === 'players' && <PlayersTab />}
      {tab === 'promotion' && <PromotionTab />}
      {tab === 'settlements' && <SettlementsTab />}
    </div>
  );
}

/** The period selector shared by Tab 1 and Tab 4. */
function RangePicker({
  value,
  onChange,
}: {
  value: AgentRange;
  onChange: (r: AgentRange) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      {RANGES.map((r) => (
        <button
          key={r}
          onClick={() => {
            haptic('light');
            onChange(r);
          }}
          className={cn(
            'shrink-0 rounded-full px-3 py-1.5 text-[0.7rem] font-semibold transition-colors',
            value === r ? 'bg-brand text-white' : 'bg-surface-2 text-dim',
          )}
        >
          {t(`agent.range.${r}`)}
        </button>
      ))}
    </div>
  );
}

// ── Tab 1: Commission Overview ───────────────────────────────────────────────

function OverviewTab() {
  const { t } = useTranslation();
  const [range, setRange] = useState<AgentRange>('today');
  const breakdown = useCommissionBreakdown(range);
  const series = useCommissionSeries(range);
  const players = useAgentPlayers();

  // §13.2: a downline holding V4/V5 earns the agent an ongoing uplift. Showing
  // WHO drives it, not just the multiplier, is what makes it actionable.
  const vipLinked = (players.data?.players ?? []).filter(
    (p) => p.vipTier === 'V4' || p.vipTier === 'V5',
  );

  return (
    <div className="space-y-4">
      <RangePicker value={range} onChange={setRange} />

      {breakdown.isPending && <Skeleton className="h-28 w-full rounded-(--radius-app)" />}
      {breakdown.isError && (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <ErrorState
            message={t(errorKey(breakdown.error))}
            onRetry={() => void breakdown.refetch()}
          />
        </div>
      )}

      {breakdown.isSuccess && (
        <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
          <Row label={t('agent.totalCommission')} value={money(breakdown.data.total)} strong />
          <Row label={t('agent.directCommission')} value={money(breakdown.data.direct)} />
          <Row label={t('agent.overrideCommission')} value={money(breakdown.data.override)} />
        </div>
      )}

      {series.isSuccess && series.data.points.length > 0 && (
        <section className="rounded-(--radius-app) border border-border bg-surface p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-dim">
            {t('agent.trend')}
          </h2>
          <Sparkline points={series.data.points} />
        </section>
      )}

      {vipLinked.length > 0 && (
        <section className="rounded-(--radius-app) border border-jackpot/30 bg-jackpot/10 p-4">
          <div className="flex items-center gap-1.5 text-xs font-bold text-jackpot">
            <TrendingUp size={14} />
            {t('agent.vipLinkage')}
          </div>
          <p className="mt-1 text-[0.66rem] leading-relaxed text-dim">
            {t('agent.vipLinkageBlurb', { count: vipLinked.length })}
          </p>
          <ul className="mt-2 space-y-1">
            {vipLinked.map((p) => (
              <li key={p.playerId} className="flex items-center justify-between text-[0.7rem]">
                <span className="truncate font-mono">{shortId(p.playerId)}</span>
                <span className="shrink-0 font-bold text-jackpot">
                  {p.vipTier} · +{p.vipTier === 'V5' ? 20 : 10}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Per-source rows — who the period's commission actually came from. */}
      {players.isSuccess && players.data.players.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
            {t('agent.bySource')}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
            {[...players.data.players]
              .sort((a, b) => b.monthCommission - a.monthCommission)
              .slice(0, 10)
              .map((p) => (
                <li key={p.playerId} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={cn('size-2 shrink-0 rounded-full', ACTIVITY_DOT[p.activity])} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {shortId(p.playerId)}
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-success">
                    {money(p.monthCommission)}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between px-4 py-3">
      <span className={cn('text-xs', strong ? 'font-bold' : 'text-dim')}>{label}</span>
      <span
        className={cn(
          'tabular-nums',
          strong ? 'text-xl font-black text-success' : 'text-sm font-semibold',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The trend line, as inline SVG.
 *
 * No chart library: the page is served under a strict CSP and the shape here is
 * a polyline over at most 30 points. A dependency would cost more than it saves.
 */
function Sparkline({ points }: { points: { date: string; amount: number }[] }) {
  const { path, peak } = useMemo(() => {
    const max = Math.max(...points.map((p) => p.amount), 1);
    const step = points.length > 1 ? 100 / (points.length - 1) : 0;
    const d = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(2)} ${(30 - (p.amount / max) * 28).toFixed(2)}`)
      .join(' ');
    return { path: d, peak: max };
  }, [points]);

  return (
    <div>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-16 w-full" role="img">
        <path d={path} fill="none" stroke="var(--color-brand)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[0.6rem] tabular-nums text-dim">
        <span>{points[0]?.date}</span>
        <span>{money(peak)}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ── Tab 2: My Players ────────────────────────────────────────────────────────

type PlayerSort = 'volume' | 'vip' | 'activity';

function PlayersTab() {
  const { t } = useTranslation();
  const players = useAgentPlayers();
  const subAgents = useAgentSubAgents();
  const [sort, setSort] = useState<PlayerSort>('volume');
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const list = [...(players.data?.players ?? [])];
    const activityRank: Record<ActivityStatus, number> = { ACTIVE: 0, DORMANT: 1, CHURNED: 2 };
    switch (sort) {
      case 'vip':
        return list.sort((a, b) => b.vipTier.localeCompare(a.vipTier));
      case 'activity':
        return list.sort((a, b) => activityRank[a.activity] - activityRank[b.activity]);
      default:
        return list.sort((a, b) => b.monthVolume - a.monthVolume);
    }
  }, [players.data, sort]);

  if (players.isPending) return <Skeleton className="h-24 w-full rounded-(--radius-app)" />;
  if (players.isError) {
    return (
      <div className="rounded-(--radius-app) border border-border bg-surface">
        <ErrorState message={t(errorKey(players.error))} onRetry={() => void players.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sorted.length === 0 ? (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <EmptyState
            icon={Users}
            title={t('agent.noPlayers')}
            description={t('agent.noPlayersBlurb')}
          />
        </div>
      ) : (
        <>
          <div className="flex gap-1.5">
            {(['volume', 'vip', 'activity'] as PlayerSort[]).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[0.7rem] font-semibold',
                  sort === s ? 'bg-brand text-white' : 'bg-surface-2 text-dim',
                )}
              >
                {t(`agent.sort.${s}`)}
              </button>
            ))}
          </div>

          <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
            {sorted.map((p) => (
              <PlayerRow
                key={p.playerId}
                player={p}
                open={expanded === p.playerId}
                onToggle={() => setExpanded(expanded === p.playerId ? null : p.playerId)}
              />
            ))}
          </ul>
        </>
      )}

      {/* §13.4 puts sub-agent performance here, as a block — not its own tab. */}
      {subAgents.isSuccess && subAgents.data.subAgents.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
            {t('agent.subAgentBlock')}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
            {subAgents.data.subAgents.map((s) => {
              const theirPlayers = sorted.filter((p) => p.viaAgentId === s.agentId);
              const upstream = theirPlayers.reduce((sum, p) => sum + p.monthCommission, 0);
              return (
                <li key={s.agentId} className="flex items-center gap-3 px-4 py-3">
                  <Network size={14} className="shrink-0 text-dim" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs">{shortId(s.agentId)}</div>
                    <div className="text-[0.62rem] text-dim">
                      {t('agent.subAgentPlayers', { count: theirPlayers.length })} · {s.rateBps / 100}%
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold tabular-nums text-success">
                      {money(upstream)}
                    </div>
                    <div className="text-[0.6rem] text-dim">{t('agent.upstreamThisMonth')}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="flex items-start gap-1.5 px-1 text-[0.66rem] leading-relaxed text-dim">
        <Lock size={11} className="mt-0.5 shrink-0" />
        {t('agent.noBalancesNote')}
      </p>
    </div>
  );
}

function PlayerRow({
  player,
  open,
  onToggle,
}: {
  player: ReferredPlayer;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

  return (
    <li>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2">
        <span className={cn('size-2 shrink-0 rounded-full', ACTIVITY_DOT[player.activity])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-xs">{shortId(player.playerId)}</span>
            <span className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[0.55rem] font-bold text-brand">
              {player.vipTier}
            </span>
          </div>
          <div className="truncate text-[0.62rem] tabular-nums text-dim">
            {t('agent.volumeToday', { amount: money(player.todayVolume) })} ·{' '}
            {t('agent.volumeMonth', { amount: money(player.monthVolume) })}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-bold tabular-nums text-success">
            {money(player.monthCommission)}
          </div>
          <div className="text-[0.6rem] text-dim">{t('agent.thisMonth')}</div>
        </div>
        <ChevronDown size={14} className={cn('shrink-0 text-dim transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-border bg-bg/40 px-4 py-3 text-[0.66rem]">
          <Detail label={t('agent.lifetimeVolume')} value={money(player.lifetimeEffective)} />
          <Detail label={t('agent.lifetimeCommission')} value={money(player.commissionGenerated)} />
          <Detail label={t('agent.todayCommissionShort')} value={money(player.todayCommission)} />
          <Detail
            label={t('agent.lastActive')}
            value={player.lastActiveAt ? new Date(player.lastActiveAt).toLocaleDateString() : t('agent.never')}
          />
          <Detail label={t('agent.sourceLink')} value={shortId(player.linkId)} mono />
          <Detail label={t('agent.joined')} value={new Date(player.boundAt).toLocaleDateString()} />
        </div>
      )}
    </li>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-dim">{label}</span>
      <span className={cn('tabular-nums', mono && 'font-mono text-[0.6rem]')}>{value}</span>
    </div>
  );
}

// ── Tab 3: Promotion Tools ───────────────────────────────────────────────────

function PromotionTab() {
  const { t } = useTranslation();
  const links = useAgentLinks();
  const subAgents = useAgentSubAgents();
  const create = useCreateReferralLink();
  const setRate = useSetSubAgentRate();

  const copy = (linkId: string): void => {
    haptic('light');
    navigator.clipboard
      .writeText(referralUrl(linkId))
      .then(() => toast.success(t('agent.linkCopied')))
      .catch(() => toast.error(t('toasts.copyFailed')));
  };

  const shareToTelegram = (linkId: string): void => {
    haptic('light');
    const url = `https://t.me/share/url?url=${encodeURIComponent(referralUrl(linkId))}`;
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="space-y-4">
      {links.isPending && <Skeleton className="h-20 w-full rounded-(--radius-app)" />}

      {links.isSuccess && links.data.links.length === 0 && (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <EmptyState icon={Link2} title={t('agent.noLinks')} description={t('agent.noLinksBlurb')} />
        </div>
      )}

      {links.isSuccess &&
        links.data.links.map((l, i) => (
          <div key={l.linkId} className="rounded-(--radius-app) border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold">
                {i === 0 ? t('agent.primaryLink') : l.label}
              </span>
              <span className="shrink-0 text-[0.66rem] tabular-nums text-dim">
                {t('agent.registrations', { count: l.registrations })}
              </span>
            </div>
            <div className="mt-2 truncate rounded-lg bg-surface-2 px-2 py-1.5 font-mono text-[0.6rem] text-dim">
              {referralUrl(l.linkId)}
            </div>
            <div className="mt-2 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => copy(l.linkId)}>
                <Copy size={14} className="mr-1.5" />
                {t('agent.copyLink')}
              </Button>
              <Button variant="ghost" className="flex-1" onClick={() => shareToTelegram(l.linkId)}>
                <Share2 size={14} className="mr-1.5" />
                {t('agent.shareToTg')}
              </Button>
            </div>
          </div>
        ))}

      <Button
        full
        variant="ghost"
        disabled={create.isPending}
        onClick={() => {
          haptic('light');
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

      {/* Sub-agent management, per §13.4 Tab 3. */}
      {subAgents.isSuccess && subAgents.data.subAgents.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">
            {t('agent.subAgentManagement')}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
            {subAgents.data.subAgents.map((s) => (
              <li key={s.agentId} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{shortId(s.agentId)}</span>
                <span className="shrink-0 text-sm font-bold tabular-nums">{s.rateBps / 100}%</span>
                <button
                  className="shrink-0 rounded-lg bg-surface-2 p-1.5 text-dim active:bg-border"
                  aria-label={t('agent.editRate')}
                  onClick={() => {
                    haptic('light');
                    const input = window.prompt(t('agent.editRatePrompt'), String(s.rateBps / 100));
                    if (input === null) return;
                    const pct = Number(input);
                    if (!Number.isFinite(pct)) {
                      toast.error(t('agent.rateInvalid'));
                      return;
                    }
                    setRate.mutate(
                      { subAgentId: s.agentId, rateBps: Math.round(pct * 100) },
                      {
                        // The 5–25% range and the "keep 5%" ceiling are enforced
                        // server-side; the message shown is the server's own.
                        onSuccess: () => toast.success(t('agent.rateUpdated')),
                        onError: (e) =>
                          toast.error(e instanceof Error ? e.message : t('states.error')),
                      },
                    );
                  }}
                >
                  <Pencil size={13} />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 px-1 text-[0.66rem] leading-relaxed text-dim">
            {t('agent.rateChangeNote')}
          </p>
        </section>
      )}
    </div>
  );
}

// ── Tab 4: Settlement Records ────────────────────────────────────────────────

function SettlementsTab() {
  const { t } = useTranslation();
  const [range, setRange] = useState<AgentRange>('today');
  const [source, setSource] = useState<'DIRECT' | 'OVERRIDE' | undefined>(undefined);
  const settlements = useSettlements(range, source);

  return (
    <div className="space-y-3">
      <RangePicker value={range} onChange={setRange} />

      <div className="flex gap-1.5">
        {([undefined, 'DIRECT', 'OVERRIDE'] as const).map((s) => (
          <button
            key={s ?? 'all'}
            onClick={() => setSource(s)}
            className={cn(
              'rounded-full px-3 py-1.5 text-[0.7rem] font-semibold',
              source === s ? 'bg-brand text-white' : 'bg-surface-2 text-dim',
            )}
          >
            {t(`agent.source.${s ?? 'all'}`)}
          </button>
        ))}
      </div>

      {settlements.isPending && <Skeleton className="h-24 w-full rounded-(--radius-app)" />}
      {settlements.isError && (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <ErrorState
            message={t(errorKey(settlements.error))}
            onRetry={() => void settlements.refetch()}
          />
        </div>
      )}

      {settlements.isSuccess && settlements.data.records.length === 0 && (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <EmptyState icon={Download} title={t('agent.noRecords')} description={t('agent.noRecordsBlurb')} />
        </div>
      )}

      {settlements.isSuccess && settlements.data.records.length > 0 && (
        <>
          <Button full variant="ghost" onClick={() => exportCsv(settlements.data.records)}>
            <Download size={14} className="mr-1.5" />
            {t('agent.exportCsv')}
          </Button>

          {/* Said out loud: a silently truncated list reads as short payment. */}
          {settlements.data.truncated && (
            <p className="rounded-lg bg-jackpot/10 px-3 py-2 text-[0.66rem] text-jackpot">
              {t('agent.truncated')}
            </p>
          )}

          <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
            {settlements.data.records.map((rec) => (
              <li key={rec.recordId} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-semibold">
                    {t(`gameNames.${rec.gameId}`, { defaultValue: rec.gameId })}
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-success">
                    {money(rec.amount)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[0.62rem] text-dim">
                  <span className="truncate">
                    {new Date(rec.at).toLocaleString()} ·{' '}
                    {rec.kind === 'OVERRIDE' && rec.viaAgentId
                      ? t('agent.viaSubAgent', { id: shortId(rec.viaAgentId) })
                      : shortId(rec.playerId)}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {t('agent.rakeWas', { amount: money(rec.rakeAmount) })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * CSV of exactly what is on screen, for tax records and reconciliation (§13.4).
 *
 * Amounts are written in whole USD with six decimals rather than the micro-USD
 * integers used internally — a spreadsheet is the one place the raw unit would
 * be actively misleading.
 */
function exportCsv(records: SettlementRecord[]): void {
  const header = 'timestamp,source,via_sub_agent,kind,game,round_id,rake_usd,commission_usd';
  const rows = records.map((r) =>
    [
      r.at,
      r.playerId,
      r.viaAgentId ?? '',
      r.kind,
      r.gameId,
      r.roundId,
      (r.rakeAmount / 1_000_000).toFixed(6),
      (r.amount / 1_000_000).toFixed(6),
    ].join(','),
  );

  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `settlement-records-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── shared ───────────────────────────────────────────────────────────────────

const referralUrl = (linkId: string): string => `https://t.me/MyPokerApp2Bot?start=${linkId}`;

/** Ids are long; the head and tail are what a human matches on. */
const shortId = (id: string): string => (id.length <= 14 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`);

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
