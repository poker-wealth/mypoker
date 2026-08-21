import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import {
  createReferralLink,
  fetchAgent,
  fetchAgentEligibility,
  fetchAgentLinks,
  fetchAgentPlayers,
  fetchCommissionBreakdown,
  fetchCommissionSeries,
  fetchSettlements,
  fetchSubAgents,
  referralUrl,
  setSubAgentRate,
  shortId,
  type ActivityStatus,
  type AgentRange,
  type ReferredPlayer,
  type SettlementRecord,
} from '../agent';
import { money } from '../money';
import { radius, space, theme } from '../theme';
import { Badge, Button, Card, EmptyState, ErrorState, ListRow, Segmented, Sheet, Skeleton } from '../ui';

/**
 * Agent Center — the four-tab dashboard, ported from frontend/src/pages/AgentCenter.tsx.
 *
 * Tabs are the spec's, in the spec's order: Commission Overview, My Players,
 * Promotion Tools, Settlement Records. Sub-agents are not a tab — they are a
 * stats block inside Tab 2 and a management list inside Tab 3, which is where
 * the spec puts them.
 *
 * Note what no tab shows: a player's balance. The spec forbids it and the
 * server has no field to leak one, so it is structural rather than a filter
 * applied here — the only way a rule like that survives a refactor.
 *
 * Every period total comes from the server. A client computing its own "this
 * week" from the device clock would give agents in different timezones
 * different totals for the same tab, and neither would reconcile against the
 * settlement records underneath it.
 *
 * FOUR THINGS DID NOT PORT — the web leans on browser APIs RN does not have:
 *
 *   window.prompt       -> `Sheet` + TextInput. Used for the link label and for
 *                          the sub-agent rate. The rate one is money-adjacent,
 *                          so it gets an explicit confirm rather than a prompt
 *                          whose Enter key commits a change to someone's pay.
 *   navigator.clipboard -> expo-clipboard.
 *   window.open(t.me)   -> the native share sheet. Forcing a Telegram URL would
 *                          dead-end on a device without Telegram installed; the
 *                          sheet offers Telegram when it is there and every
 *                          other target when it is not.
 *   Blob + <a download> -> a file written to the cache directory and handed to
 *                          the OS share sheet. That is what "export" means on a
 *                          phone, which has no visible filesystem to save into.
 *
 * There is no toast system in this app (see AllianceScreen). Success is the
 * data updating; failure is shown inline, next to the control that caused it.
 */

type Tab = 'overview' | 'players' | 'promotion' | 'settlements';

const RANGES: AgentRange[] = ['today', 'week', '30d', 'all'];

/** Activity is a dot, as on the web: colour carries it, with no extra label. */
const ACTIVITY_DOT: Record<ActivityStatus, string> = {
  ACTIVE: theme.success,
  DORMANT: theme.jackpot,
  CHURNED: theme.dim,
};

export function AgentCenterScreen() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('overview');

  const agent = useQuery({ queryKey: ['agent'], queryFn: fetchAgent, retry: 1 });
  // The entry card shows TODAY's commission, not the all-time total.
  const today = useQuery({
    queryKey: ['agent', 'breakdown', 'today'],
    queryFn: () => fetchCommissionBreakdown('today'),
    retry: 1,
  });

  if (agent.isPending) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }

  if (agent.isError) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <ErrorState
          message={agent.error instanceof Error ? agent.error.message : t('states.error')}
          onRetry={() => agent.refetch()}
          retryLabel={t('common.retry')}
        />
      </ScrollView>
    );
  }

  // Null rather than 404 — an ordinary player is not an error.
  if (!agent.data.agent) return <NotAnAgent />;

  const summary = agent.data.agent;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.badgeRow}>
          <Badge tone="brand">
            {summary.parentAgentId ? t('agent.badgeSub') : t('agent.badgeAgent')}
          </Badge>
          <Text style={styles.dim}>{t('agent.rateLine', { rate: summary.rateBps / 100 })}</Text>
        </View>

        <Text style={styles.caption}>{t('agent.todayCommission')}</Text>
        {today.isSuccess ? (
          <Text style={styles.hero}>{money(today.data.total)}</Text>
        ) : today.isPending ? (
          <Skeleton width={140} />
        ) : (
          // An em dash, never a zero: a zero here is a claim about earnings.
          <Text style={styles.hero}>—</Text>
        )}

        <Text style={styles.dim}>
          {t('agent.playersUnderManagement', { count: summary.playerCount })}
        </Text>
      </Card>

      <Segmented
        options={[
          { value: 'overview' as const, label: t('agent.tab.overview') },
          { value: 'players' as const, label: t('agent.tab.players') },
          { value: 'promotion' as const, label: t('agent.tab.promotion') },
          { value: 'settlements' as const, label: t('agent.tab.settlements') },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' && <OverviewTab />}
      {tab === 'players' && <PlayersTab />}
      {tab === 'promotion' && <PromotionTab />}
      {tab === 'settlements' && <SettlementsTab />}
    </ScrollView>
  );
}

/** The period selector shared by Tab 1 and Tab 4. */
function RangePicker({ value, onChange }: { value: AgentRange; onChange: (r: AgentRange) => void }) {
  const { t } = useTranslation();
  return (
    <Segmented
      options={RANGES.map((r) => ({ value: r, label: t(`agent.range.${r}`) }))}
      value={value}
      onChange={onChange}
    />
  );
}

// ── Tab 1: Commission Overview ───────────────────────────────────────────────

function OverviewTab() {
  const { t } = useTranslation();
  const [range, setRange] = useState<AgentRange>('today');

  const breakdown = useQuery({
    queryKey: ['agent', 'breakdown', range],
    queryFn: () => fetchCommissionBreakdown(range),
    retry: 1,
  });
  const series = useQuery({
    queryKey: ['agent', 'series', range],
    queryFn: () => fetchCommissionSeries(range),
    retry: 1,
  });
  const players = useQuery({ queryKey: ['agent', 'players'], queryFn: fetchAgentPlayers, retry: 1 });

  // A downline holding V4/V5 earns the agent an ongoing uplift. Showing WHO
  // drives it, not just the multiplier, is what makes it actionable.
  const vipLinked = (players.data?.players ?? []).filter(
    (p) => p.vipTier === 'V4' || p.vipTier === 'V5',
  );

  return (
    <View style={styles.stack}>
      <RangePicker value={range} onChange={setRange} />

      {breakdown.isPending && <Skeleton width={200} />}
      {breakdown.isError && (
        <ErrorState
          message={breakdown.error instanceof Error ? breakdown.error.message : t('states.error')}
          onRetry={() => breakdown.refetch()}
          retryLabel={t('common.retry')}
        />
      )}
      {breakdown.isSuccess && (
        <Card style={styles.listCard}>
          <ListRow
            label={t('agent.totalCommission')}
            right={<Text style={styles.strong}>{money(breakdown.data.total)}</Text>}
          />
          <ListRow
            label={t('agent.directCommission')}
            right={<Text style={styles.figure}>{money(breakdown.data.direct)}</Text>}
          />
          <ListRow
            label={t('agent.overrideCommission')}
            right={<Text style={styles.figure}>{money(breakdown.data.override)}</Text>}
          />
        </Card>
      )}

      {series.isSuccess && series.data.points.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>{t('agent.trend')}</Text>
          <Sparkline points={series.data.points} />
        </Card>
      )}

      {vipLinked.length > 0 && (
        <Card style={styles.vipCard}>
          <Text style={styles.vipTitle}>{t('agent.vipLinkage')}</Text>
          <Text style={styles.dim}>{t('agent.vipLinkageBlurb', { count: vipLinked.length })}</Text>
          {vipLinked.map((p) => (
            <View key={p.playerId} style={styles.vipRow}>
              <Text style={styles.mono} numberOfLines={1}>
                {shortId(p.playerId)}
              </Text>
              {/* Uplift figures mirror the web exactly; both read the same
                  ladder the VIP page uses. */}
              <Text style={styles.vipValue}>
                {p.vipTier} · +{p.vipTier === 'V5' ? 20 : 10}%
              </Text>
            </View>
          ))}
        </Card>
      )}

      {players.isSuccess && players.data.players.length > 0 && (
        <View style={styles.stack}>
          <Text style={styles.sectionTitle}>{t('agent.bySource')}</Text>
          <Card style={styles.listCard}>
            {[...players.data.players]
              .sort((a, b) => b.monthCommission - a.monthCommission)
              .slice(0, 10)
              .map((p) => (
                <ListRow
                  key={p.playerId}
                  label={shortId(p.playerId)}
                  right={
                    <View style={styles.rightRow}>
                      <View style={[styles.dot, { backgroundColor: ACTIVITY_DOT[p.activity] }]} />
                      <Text style={styles.figure}>{money(p.monthCommission)}</Text>
                    </View>
                  }
                />
              ))}
          </Card>
        </View>
      )}
    </View>
  );
}

/**
 * The trend line.
 *
 * Same shape as the web's inline SVG — a polyline over at most 30 points, no
 * charting library. Unlike `TrendChart` this is not a cumulative profit line
 * and has no zero crossing, so it needs neither the gradient nor the fill.
 */
function Sparkline({ points }: { points: { date: string; amount: number }[] }) {
  const [width, setWidth] = useState(0);
  const height = 60;

  const path = useMemo(() => {
    if (points.length < 2 || width === 0) return '';
    const max = Math.max(...points.map((p) => p.amount), 1);
    const step = width / (points.length - 1);
    return points
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${(height - (p.amount / max) * (height - 4)).toFixed(2)}`,
      )
      .join(' ');
  }, [points, width]);

  const peak = Math.max(...points.map((p) => p.amount), 0);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {path !== '' && (
        <Svg width={width} height={height}>
          <Path d={path} stroke={theme.brand} strokeWidth={1.5} fill="none" />
        </Svg>
      )}
      <View style={styles.sparkAxis}>
        <Text style={styles.axisText}>{points[0]?.date}</Text>
        <Text style={styles.axisText}>{money(peak)}</Text>
        <Text style={styles.axisText}>{points[points.length - 1]?.date}</Text>
      </View>
    </View>
  );
}

// ── Tab 2: My Players ────────────────────────────────────────────────────────

type PlayerSort = 'volume' | 'vip' | 'activity';

function PlayersTab() {
  const { t } = useTranslation();
  const players = useQuery({ queryKey: ['agent', 'players'], queryFn: fetchAgentPlayers, retry: 1 });
  const subAgents = useQuery({ queryKey: ['agent', 'subAgents'], queryFn: fetchSubAgents, retry: 1 });
  const [sort, setSort] = useState<PlayerSort>('volume');
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const list = [...(players.data?.players ?? [])];
    const rank: Record<ActivityStatus, number> = { ACTIVE: 0, DORMANT: 1, CHURNED: 2 };
    switch (sort) {
      case 'vip':
        return list.sort((a, b) => b.vipTier.localeCompare(a.vipTier));
      case 'activity':
        return list.sort((a, b) => rank[a.activity] - rank[b.activity]);
      default:
        return list.sort((a, b) => b.monthVolume - a.monthVolume);
    }
  }, [players.data, sort]);

  if (players.isPending) return <Skeleton width={220} />;
  if (players.isError) {
    return (
      <ErrorState
        message={players.error instanceof Error ? players.error.message : t('states.error')}
        onRetry={() => players.refetch()}
        retryLabel={t('common.retry')}
      />
    );
  }

  return (
    <View style={styles.stack}>
      {sorted.length === 0 ? (
        <Card>
          <EmptyState title={t('agent.noPlayers')} body={t('agent.noPlayersBlurb')} />
        </Card>
      ) : (
        <>
          <Segmented
            options={(['volume', 'vip', 'activity'] as PlayerSort[]).map((s) => ({
              value: s,
              label: t(`agent.sort.${s}`),
            }))}
            value={sort}
            onChange={setSort}
          />
          <Card style={styles.listCard}>
            {sorted.map((p) => (
              <PlayerRow
                key={p.playerId}
                player={p}
                open={expanded === p.playerId}
                onToggle={() => setExpanded(expanded === p.playerId ? null : p.playerId)}
              />
            ))}
          </Card>
        </>
      )}

      {/* Sub-agent performance lives here, as a block — not its own tab. */}
      {subAgents.isSuccess && subAgents.data.subAgents.length > 0 && (
        <View style={styles.stack}>
          <Text style={styles.sectionTitle}>{t('agent.subAgentBlock')}</Text>
          <Card style={styles.listCard}>
            {subAgents.data.subAgents.map((s) => {
              const theirs = sorted.filter((p) => p.viaAgentId === s.agentId);
              const upstream = theirs.reduce((sum, p) => sum + p.monthCommission, 0);
              return (
                <ListRow
                  key={s.agentId}
                  label={shortId(s.agentId)}
                  hint={`${t('agent.subAgentPlayers', { count: theirs.length })} · ${s.rateBps / 100}%`}
                  right={
                    <View style={styles.rightCol}>
                      <Text style={styles.figure}>{money(upstream)}</Text>
                      <Text style={styles.axisText}>{t('agent.upstreamThisMonth')}</Text>
                    </View>
                  }
                />
              );
            })}
          </Card>
        </View>
      )}

      <Text style={styles.note}>{t('agent.noBalancesNote')}</Text>
    </View>
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
    <View>
      <ListRow
        label={shortId(player.playerId)}
        hint={`${t('agent.volumeToday', { amount: money(player.todayVolume) })} · ${t('agent.volumeMonth', { amount: money(player.monthVolume) })}`}
        onPress={onToggle}
        right={
          <View style={styles.rightRow}>
            <View style={[styles.dot, { backgroundColor: ACTIVITY_DOT[player.activity] }]} />
            <Badge tone="brand">{player.vipTier}</Badge>
            <View style={styles.rightCol}>
              <Text style={styles.figure}>{money(player.monthCommission)}</Text>
              <Text style={styles.axisText}>{t('agent.thisMonth')}</Text>
            </View>
          </View>
        }
      />
      {open && (
        <View style={styles.detail}>
          <Detail label={t('agent.lifetimeVolume')} value={money(player.lifetimeEffective)} />
          <Detail label={t('agent.lifetimeCommission')} value={money(player.commissionGenerated)} />
          <Detail label={t('agent.todayCommissionShort')} value={money(player.todayCommission)} />
          <Detail
            label={t('agent.lastActive')}
            value={
              player.lastActiveAt
                ? new Date(player.lastActiveAt).toLocaleDateString()
                : t('agent.never')
            }
          />
          <Detail label={t('agent.sourceLink')} value={shortId(player.linkId)} mono />
          <Detail label={t('agent.joined')} value={new Date(player.boundAt).toLocaleDateString()} />
        </View>
      )}
    </View>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.dim}>{label}</Text>
      <Text style={mono ? styles.mono : styles.detailValue}>{value}</Text>
    </View>
  );
}

// ── Tab 3: Promotion Tools ───────────────────────────────────────────────────

function PromotionTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const links = useQuery({ queryKey: ['agent', 'links'], queryFn: fetchAgentLinks, retry: 1 });
  const subAgents = useQuery({ queryKey: ['agent', 'subAgents'], queryFn: fetchSubAgents, retry: 1 });

  const [labelSheet, setLabelSheet] = useState(false);
  const [label, setLabel] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [rateFor, setRateFor] = useState<{ agentId: string; rateBps: number } | null>(null);

  const create = useMutation({
    mutationFn: (body: { label?: string }) => createReferralLink(body),
    onSuccess: () => {
      setLabelSheet(false);
      setLabel('');
      void queryClient.invalidateQueries({ queryKey: ['agent', 'links'] });
    },
  });

  const copy = async (linkId: string): Promise<void> => {
    await Clipboard.setStringAsync(referralUrl(linkId));
    // No toast system: the button says so itself, briefly.
    setCopied(linkId);
    setTimeout(() => setCopied(null), 2000);
  };

  const share = async (linkId: string): Promise<void> => {
    // The native sheet rather than a t.me URL: on a device without Telegram
    // the web's window.open would dead-end, and the sheet lists Telegram
    // anyway when it is installed.
    await Share.share({ message: referralUrl(linkId) });
  };

  return (
    <View style={styles.stack}>
      {links.isPending && <Skeleton width={200} />}

      {links.isSuccess && links.data.links.length === 0 && (
        <Card>
          <EmptyState title={t('agent.noLinks')} body={t('agent.noLinksBlurb')} />
        </Card>
      )}

      {links.isSuccess &&
        links.data.links.map((l, i) => (
          <Card key={l.linkId}>
            <View style={styles.linkHead}>
              <Text style={styles.linkTitle} numberOfLines={1}>
                {i === 0 ? t('agent.primaryLink') : l.label}
              </Text>
              <Text style={styles.dim}>{t('agent.registrations', { count: l.registrations })}</Text>
            </View>
            <Text style={styles.url} numberOfLines={1}>
              {referralUrl(l.linkId)}
            </Text>
            <View style={styles.buttonRow}>
              <View style={styles.flex}>
                <Button variant="ghost" onPress={() => void copy(l.linkId)}>
                  {copied === l.linkId ? t('agent.linkCopied') : t('agent.copyLink')}
                </Button>
              </View>
              <View style={styles.flex}>
                <Button variant="ghost" onPress={() => void share(l.linkId)}>
                  {t('agent.shareToTg')}
                </Button>
              </View>
            </View>
          </Card>
        ))}

      <Button variant="ghost" disabled={create.isPending} onPress={() => setLabelSheet(true)}>
        {t('agent.newLink')}
      </Button>

      {create.isError && (
        <ErrorState
          message={create.error instanceof Error ? create.error.message : t('states.error')}
          retryLabel={t('common.retry')}
        />
      )}

      {subAgents.isSuccess && subAgents.data.subAgents.length > 0 && (
        <View style={styles.stack}>
          <Text style={styles.sectionTitle}>{t('agent.subAgentManagement')}</Text>
          <Card style={styles.listCard}>
            {subAgents.data.subAgents.map((s) => (
              <ListRow
                key={s.agentId}
                label={shortId(s.agentId)}
                value={`${s.rateBps / 100}%`}
                onPress={() => setRateFor({ agentId: s.agentId, rateBps: s.rateBps })}
              />
            ))}
          </Card>
          <Text style={styles.note}>{t('agent.rateChangeNote')}</Text>
        </View>
      )}

      {/* Replaces window.prompt. */}
      <Sheet open={labelSheet} onClose={() => setLabelSheet(false)} title={t('agent.newLink')}>
        <Text style={styles.dim}>{t('agent.linkLabelPrompt')}</Text>
        <TextInput
          style={styles.input}
          value={label}
          onChangeText={setLabel}
          autoCapitalize="none"
          placeholderTextColor={theme.dim}
        />
        <Button
          disabled={create.isPending}
          onPress={() => create.mutate({ label: label.trim() || 'default' })}
        >
          {create.isPending ? t('common.loading') : t('agent.newLink')}
        </Button>
      </Sheet>

      {rateFor && (
        <RateSheet
          subAgentId={rateFor.agentId}
          currentBps={rateFor.rateBps}
          onClose={() => setRateFor(null)}
        />
      )}
    </View>
  );
}

/**
 * The sub-agent rate editor.
 *
 * The web uses `window.prompt`, where Enter commits. This is a rate on somebody
 * else's earnings, so it gets a sheet with an explicit confirm and the current
 * value shown as the starting point. Backdrop dismissal cancels, per Sheet's
 * contract — for anything touching money the safe answer to a question nobody
 * answered is no.
 *
 * The 5–25% range and the "keep 5%" ceiling are NOT re-checked here. They are
 * enforced server-side, and a second copy of a bound is how two answers to the
 * same question start to exist. A refusal is shown in the server's own words.
 */
function RateSheet({
  subAgentId,
  currentBps,
  onClose,
}: {
  subAgentId: string;
  currentBps: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [text, setText] = useState(String(currentBps / 100));

  const mutation = useMutation({
    mutationFn: (rateBps: number) => setSubAgentRate(subAgentId, rateBps),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent', 'subAgents'] });
      onClose();
    },
  });

  const pct = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(pct);

  return (
    <Sheet open onClose={onClose} title={t('agent.editRate')}>
      <Text style={styles.dim}>{t('agent.editRatePrompt')}</Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
        placeholderTextColor={theme.dim}
      />
      {!valid && text.trim() !== '' && <Text style={styles.invalid}>{t('agent.rateInvalid')}</Text>}

      {mutation.isError && (
        <ErrorState
          message={mutation.error instanceof Error ? mutation.error.message : t('states.error')}
          retryLabel={t('common.retry')}
        />
      )}

      <Button
        disabled={!valid || mutation.isPending}
        onPress={() => mutation.mutate(Math.round(pct * 100))}
      >
        {mutation.isPending ? t('common.loading') : t('agent.editRate')}
      </Button>
    </Sheet>
  );
}

// ── Tab 4: Settlement Records ────────────────────────────────────────────────

function SettlementsTab() {
  const { t } = useTranslation();
  const [range, setRange] = useState<AgentRange>('today');
  const [source, setSource] = useState<'all' | 'DIRECT' | 'OVERRIDE'>('all');
  const [exportError, setExportError] = useState<string | null>(null);

  const settlements = useQuery({
    queryKey: ['agent', 'settlements', range, source],
    queryFn: () => fetchSettlements(range, source === 'all' ? undefined : source),
    retry: 1,
  });

  return (
    <View style={styles.stack}>
      <RangePicker value={range} onChange={setRange} />

      <Segmented
        options={(['all', 'DIRECT', 'OVERRIDE'] as const).map((s) => ({
          value: s,
          label: t(`agent.source.${s}`),
        }))}
        value={source}
        onChange={setSource}
      />

      {settlements.isPending && <Skeleton width={220} />}
      {settlements.isError && (
        <ErrorState
          message={settlements.error instanceof Error ? settlements.error.message : t('states.error')}
          onRetry={() => settlements.refetch()}
          retryLabel={t('common.retry')}
        />
      )}

      {settlements.isSuccess && settlements.data.records.length === 0 && (
        <Card>
          <EmptyState title={t('agent.noRecords')} body={t('agent.noRecordsBlurb')} />
        </Card>
      )}

      {settlements.isSuccess && settlements.data.records.length > 0 && (
        <>
          <Button
            variant="ghost"
            onPress={() => {
              setExportError(null);
              void exportCsv(settlements.data.records).catch((e: unknown) =>
                setExportError(e instanceof Error ? e.message : t('states.error')),
              );
            }}
          >
            {t('agent.exportCsv')}
          </Button>

          {exportError !== null && (
            <ErrorState message={exportError} retryLabel={t('common.retry')} />
          )}

          {/* Said out loud: a silently truncated list reads as short payment. */}
          {settlements.data.truncated && (
            <Card style={styles.warnCard}>
              <Text style={styles.warnText}>{t('agent.truncated')}</Text>
            </Card>
          )}

          <Card style={styles.listCard}>
            {settlements.data.records.map((rec) => (
              <ListRow
                key={rec.recordId}
                label={t(`gameNames.${rec.gameId}`, { defaultValue: rec.gameId })}
                hint={`${new Date(rec.at).toLocaleString()} · ${
                  rec.kind === 'OVERRIDE' && rec.viaAgentId
                    ? t('agent.viaSubAgent', { id: shortId(rec.viaAgentId) })
                    : shortId(rec.playerId)
                }`}
                right={
                  <View style={styles.rightCol}>
                    <Text style={styles.figure}>{money(rec.amount)}</Text>
                    <Text style={styles.axisText}>
                      {t('agent.rakeWas', { amount: money(rec.rakeAmount) })}
                    </Text>
                  </View>
                }
              />
            ))}
          </Card>
        </>
      )}
    </View>
  );
}

/**
 * CSV of exactly what is on screen, for tax records and reconciliation.
 *
 * Amounts are written in whole USD with six decimals rather than the micro-USD
 * integers used internally — a spreadsheet is the one place the raw unit would
 * be actively misleading.
 *
 * The web hands this to a download. A phone has no visible filesystem, so it is
 * written to the cache directory and passed to the OS share sheet: mail it, put
 * it in Drive, open it in a spreadsheet app. Cache rather than documents —
 * once shared it has served its purpose and the OS may reclaim it.
 */
async function exportCsv(records: SettlementRecord[]): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }

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

  const file = new File(Paths.cache, `settlement-records-${new Date().toISOString().slice(0, 10)}.csv`);
  // Exporting twice in one day must not fail on the previous run's file.
  if (file.exists) file.delete();
  file.create();
  file.write([header, ...rows].join('\n'));

  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
  });
}

/** Shown to the great majority of players, who are not agents. */
function NotAnAgent() {
  const { t } = useTranslation();
  const eligibility = useQuery({
    queryKey: ['agent', 'eligibility'],
    queryFn: fetchAgentEligibility,
    retry: 1,
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card style={styles.centreCard}>
        <Text style={styles.becomeTitle}>{t('agent.becomeTitle')}</Text>
        <Text style={styles.becomeBlurb}>{t('agent.becomeBlurb')}</Text>
      </Card>

      {eligibility.isSuccess && (
        <Card>
          <View style={styles.linkHead}>
            <Text style={styles.sectionTitle}>{t('agent.requirement')}</Text>
            <Text style={styles.dim}>
              {eligibility.data.reputation} / {eligibility.data.required}
            </Text>
          </View>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.min(100, (eligibility.data.reputation / eligibility.data.required) * 100)}%`,
                },
              ]}
            />
          </View>
          <Text style={styles.dim}>
            {eligibility.data.eligible ? t('agent.eligibleNote') : t('agent.notEligibleNote')}
          </Text>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: space.lg, gap: space.md },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
  stack: { gap: space.md },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  caption: { color: theme.dim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  hero: { color: theme.success, fontSize: 30, fontWeight: '900' },
  dim: { color: theme.dim, fontSize: 11 },
  sectionTitle: { color: theme.dim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  listCard: { padding: 0, paddingHorizontal: space.md, gap: 0 },
  strong: { color: theme.success, fontSize: 20, fontWeight: '900' },
  figure: { color: theme.success, fontSize: 14, fontWeight: '700' },
  rightRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rightCol: { alignItems: 'flex-end' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  mono: { color: theme.text, fontSize: 11 },
  detail: { paddingHorizontal: space.sm, paddingBottom: space.sm, gap: 4 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  detailValue: { color: theme.text, fontSize: 11 },
  note: { color: theme.dim, fontSize: 11, lineHeight: 17, paddingHorizontal: space.xs },
  vipCard: { borderColor: 'rgba(245,185,59,0.3)', backgroundColor: 'rgba(245,185,59,0.1)' },
  vipTitle: { color: theme.jackpot, fontSize: 12, fontWeight: '800' },
  vipRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  vipValue: { color: theme.jackpot, fontSize: 11, fontWeight: '800' },
  sparkAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  axisText: { color: theme.dim, fontSize: 10 },
  linkHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  linkTitle: { color: theme.text, fontSize: 14, fontWeight: '700', flex: 1 },
  url: {
    backgroundColor: theme.surface2,
    borderRadius: 8,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    color: theme.dim,
    fontSize: 10,
  },
  buttonRow: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: theme.text,
    fontSize: 15,
  },
  invalid: { color: theme.danger, fontSize: 11 },
  warnCard: { borderColor: 'rgba(245,185,59,0.3)', backgroundColor: 'rgba(245,185,59,0.1)' },
  warnText: { color: theme.jackpot, fontSize: 11, lineHeight: 17 },
  centreCard: { alignItems: 'center' },
  becomeTitle: { color: theme.text, fontSize: 16, fontWeight: '800' },
  becomeBlurb: { color: theme.dim, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: theme.brand },
});
