import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../api';
import {
  explorerUrl,
  ownSeedAtSeat,
  verifyRound,
  type RoundVerificationData,
  type SeatedClientSeed,
  type StepId,
  type VerificationResult,
} from '../fairness';
import { HIDDEN_GAMES, visibleGames } from '../games';
import { radius, space, theme } from '../theme';
import { Badge, Button, Card, ErrorState, Skeleton } from '../ui';

/**
 * Fairness verification — ported from `frontend/src/pages/Fairness.tsx`
 * (the 6-step verifier from the v6.0 UltraFair spec).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS SCREEN NOW VERIFIES FOR REAL
 *
 * All six steps, on web, are SHA-256 arithmetic run through
 * `crypto.subtle.digest` (`frontend/src/lib/fairness.ts`): the commitment
 * check, the seed merge, the shuffle's own RNG stream, the round hash, and
 * the Merkle proof's pairwise hashing all go through it. React Native /
 * Hermes has no `crypto.subtle` — the same gap `mobile/CLAUDE.md` documents
 * for the table transport's X25519/HKDF/HMAC path — but `expo-crypto`'s
 * `digest()` has the same shape (`(algorithm, BufferSource) => Promise<
 * ArrayBuffer>`), so `../fairness.ts` is a byte-for-byte native port built on
 * top of it instead of a hand-rolled SHA-256. That port is pinned to a
 * server-generated vector in `mobile/scripts/check-fairness.mjs`, for the
 * same reason `fairness.ts`'s own header gives: "a drift would tell an
 * honest player their hand was rigged".
 *
 * So every step below runs `verifyRound` on-device and renders a real
 * success/warn verdict — never a neutral placeholder standing in for one.
 * Two things remain honestly outside what this screen can prove, and it says
 * so rather than papering over it:
 *
 *   - Step 6b (the on-chain anchor) is a chain query the player makes
 *     themselves via the explorer link; there is nothing to recompute here.
 *   - Step 3's own-seed half needs `mine` (the viewer's own seat + seed),
 *     which is absent for a round the viewer did not play. The merge is
 *     still verified; the "your seed" half is noted as unchecked rather than
 *     silently passed.
 * ─────────────────────────────────────────────────────────────────────────
 */

const STEP_KEYS: Record<StepId, { title: string; blurb: string; expectedOf: (d: RoundVerificationData) => string }> = {
  1: { title: 'fairness.step1', blurb: 'fairness.step1Blurb', expectedOf: (d) => d.serverCommit },
  2: { title: 'fairness.step2', blurb: 'fairness.step2Blurb', expectedOf: (d) => d.finalSeed },
  3: { title: 'fairness.step3', blurb: 'fairness.step3Blurb', expectedOf: (d) => d.allClientSeeds },
  4: { title: 'fairness.step4', blurb: 'fairness.step4Blurb', expectedOf: (d) => (d.cards ?? []).slice(0, 5).join(' ') },
  5: { title: 'fairness.step5', blurb: 'fairness.step5Blurb', expectedOf: (d) => d.roundHash },
  6: { title: 'fairness.step6', blurb: 'fairness.step6Blurb', expectedOf: (d) => d.merkleRoot },
};

/**
 * `frontend/src/lib/__fixtures__/round-vector.json` — the same server-
 * generated vector the web module's own tests (`fairness.test.ts`) and
 * `mobile/scripts/check-fairness.mjs` pin against — embedded rather than
 * imported for the same cross-boundary reason `games.ts` duplicates the
 * catalog (mobile has no module path into `frontend/src/lib`; only the i18n
 * locales folder is wired into Metro's watchFolders). Loading it exercises
 * the real verifier end to end, all six steps.
 */
const SAMPLE_ROUND: RoundVerificationData = {
  roundId: 'round-vector-0001',
  serverSeed: '853cfcb1380fc2550a1dbeee35b90fd1117ca9c4b2f8ea2f695f22aab6b70f43',
  serverCommit: '3d8ae4de019a826dfbccedbb629b86e4b196e76d32f690cd6fbe21ee981bfb81',
  allClientSeeds: '64e814d3fa35862abc9dad9d2a8dce4daa1054638b4dab60b3f80e7fd1d0ad0c',
  futureBlockHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  finalSeed: 'c2043bd06102dd641775bc11affa1e44035cefc1274b687dd5d712603c312a5b',
  cards: [
    '4h', '6s', '7s', 'Jc', 'Ah', '9d', 'Qh', 'Ts', 'Jh', 'Ac', 'Qd', 'Js', '3d', '5d', '5c', 'Td',
    '3s', 'Qs', '4s', '4d', 'Ad', '3h', 'Kd', 'Kh', '8c', 'As', '3c', '8s', '9c', '7d', '6h', 'Jd',
    'Th', 'Qc', 'Kc', '8d', '2h', '6c', 'Ks', '7h', '2s', '5s', '5h', '6d', '7c', '2d', '8h', '9h',
    '2c', 'Tc', '4c', '9s',
  ],
  timestamp: 1770000000000,
  roundHash: 'ec08e5501ca3b5dbe078ea5198614e985b98a4ef4be99590b99ab3ad9c282bf5',
  merkleProof: [
    { hash: 'fc6297b671452162fe21ad3aa19da8508e8f5b7a552f1d8afed50e25c36b6d37', right: true },
    { hash: 'ad80a67fd9f2685869bb5c1726f2f89017be7f4b4c2720aaa71c561a2a94e38b', right: true },
    { hash: '14d491556787b67cd03fd280387a8daf71969b0dd6d539769d2bf3bc3ca8cf05', right: true },
  ],
  merkleRoot: 'd242c0ae0a406cf0c2af007546beea5f47f4d486c7b9ef1c122391f6e9251b40',
  seatedClientSeeds: [
    { seatOrder: 1, clientSeed: 'c3b85d4ded0fb4d7b524a0c2d8bad1cea7daa39a35f625853b64d8c1815d6f1b' },
    { seatOrder: 2, clientSeed: '5edda8ee47c4d0d10a1e7b0c4becf20c581739e1ad9438ec2012fab2e869c358' },
    { seatOrder: 3, clientSeed: 'fa4c6de9e474e064966358ce5e81037fc0f92c4dc4fc475b4a28b3d5c1b4ada0' },
    { seatOrder: 4, clientSeed: 'ce6f1ab4d691d6134ed1c881fb279aecf7b6421d21895174743f95096e11bd81' },
    { seatOrder: 5, clientSeed: '3d28e3751c2e356d055c66866fb521305c706442f51a5fe99e4a9d53fbf88a9e' },
    { seatOrder: 6, clientSeed: '12ab3f7fc2af6e95880959476bbe88ec300a493864bbd6717a54c5f4d59a0d83' },
  ],
};

// ─── the screen ──────────────────────────────────────────────────────────

export function FairnessScreen() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [parsed, setParsed] = useState<RoundVerificationData | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const run = (raw: string): void => {
    setParseError(null);
    setParsed(null);
    try {
      const candidate = JSON.parse(raw) as RoundVerificationData;
      // A minimal shape check — enough to fail loudly on garbage rather than
      // crash later while rendering. Not a full schema validator; the web
      // module does not have one either (it casts the same way).
      if (typeof candidate !== 'object' || candidate === null || !Array.isArray(candidate.cards)) {
        throw new Error(t('fairness.badInput'));
      }
      setParsed(candidate);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : t('fairness.badInput'));
    }
  };

  const loadSample = (): void => {
    const text = JSON.stringify(SAMPLE_ROUND, null, 2);
    setInput(text);
    run(text);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <Card style={styles.introCard}>
          <View style={styles.introRow}>
            <View style={styles.introIcon}>
              <Text style={styles.introIconText}>🛡️</Text>
            </View>
            <View style={styles.introBody}>
              <Text style={styles.title}>{t('fairness.title')}</Text>
              <Text style={styles.dim}>{t('fairness.intro')}</Text>
            </View>
          </View>
        </Card>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('fairness.roundData')}</Text>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={t('fairness.paste')}
            placeholderTextColor={theme.dim}
            multiline
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.textArea}
          />
          <View style={styles.buttonRow}>
            <View style={styles.buttonFlex}>
              <Button onPress={() => run(input)} disabled={!input.trim()}>
                {t('fairness.verify')}
              </Button>
            </View>
            <Button variant="ghost" onPress={loadSample}>
              {t('fairness.sample')}
            </Button>
          </View>
        </View>

        {parseError && (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>
              {t('fairness.couldNotRead')} <Text style={styles.mono}>{parseError}</Text>
            </Text>
          </Card>
        )}

        <GameFairnessList />

        {parsed && <RoundSteps data={parsed} />}
      </View>
    </View>
  );
}

/**
 * The six-step breakdown for a parsed round.
 *
 * Runs `verifyRound` (`../fairness.ts`) on the device and renders its real
 * verdict per step — a green badge only for a step that actually recomputed
 * and matched, a red one for a genuine mismatch. While the hashing is still
 * in flight (a handful of `expo-crypto` calls, effectively instant) each
 * badge sits neutral rather than guessing.
 *
 * Two things stay honestly qualified rather than a bare pass:
 *   - Step 3 notes when the viewer's own seed couldn't be checked (`mine` is
 *     absent for a round they did not play) — the merge is still verified.
 *   - Step 6b (on-chain anchoring) is never computed here; it is a link the
 *     player follows to check the chain themselves.
 */
function RoundSteps({ data }: { data: RoundVerificationData }) {
  const { t } = useTranslation();
  const seatedClientSeeds = Array.isArray(data.seatedClientSeeds) ? data.seatedClientSeeds : [];
  const link = explorerUrl(data.notarization);

  const [result, setResult] = useState<VerificationResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setVerifyError(null);
    verifyRound(data)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((err) => {
        if (!cancelled) setVerifyError(err instanceof Error ? err.message : t('fairness.badInput'));
      });
    return () => {
      cancelled = true;
    };
    // `data` is a freshly parsed object each run, which is exactly when this
    // should re-verify — a shallower dependency would miss edits to the same
    // pasted JSON.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <View style={styles.section}>
      {verifyError && (
        <Card style={styles.errorCard}>
          <Text style={styles.errorText}>
            {t('fairness.couldNotRead')} <Text style={styles.mono}>{verifyError}</Text>
          </Text>
        </Card>
      )}

      {result && (
        <Card style={result.allPass ? styles.bannerOk : styles.bannerFail}>
          <View style={styles.bannerRow}>
            <Badge tone={result.allPass ? 'success' : 'warn'}>
              {result.allPass ? t('fairness.verified') : t('fairness.failed')}
            </Badge>
            <Text style={styles.dim}>
              {result.allPass ? t('fairness.verifiedBlurb') : t('fairness.failedBlurb')}
            </Text>
          </View>
        </Card>
      )}

      <View style={styles.stepList}>
        {([1, 2, 3, 4, 5, 6] as StepId[]).map((step) => {
          const meta = STEP_KEYS[step];
          let expected = '';
          try {
            expected = meta.expectedOf(data) ?? '';
          } catch {
            expected = '';
          }

          const stepResult = result?.steps.find((s) => s.step === step);
          const tone = !stepResult ? 'neutral' : stepResult.pass ? 'success' : 'warn';
          const badgeLabel = !stepResult ? '—' : stepResult.pass ? t('fairness.verified') : t('fairness.failed');

          return (
            <Card key={step} style={styles.stepCard}>
              <View style={styles.stepHeader}>
                <Badge tone={tone}>{badgeLabel}</Badge>
                <View style={styles.stepHeaderText}>
                  <Text style={styles.stepTitle}>
                    {step}. {t(meta.title)}
                  </Text>
                  <Text style={styles.stepBlurb}>{t(meta.blurb)}</Text>
                </View>
              </View>

              {stepResult ? (
                <>
                  <Value label={t('fairness.computed')} value={stepResult.computed} tone={stepResult.pass ? 'ok' : 'bad'} />
                  <Value label={t('fairness.expected')} value={stepResult.expected} />
                </>
              ) : (
                <Value label={t('fairness.expected')} value={expected} />
              )}

              {step === 3 && stepResult?.note === 'OWN_SEED_NOT_CHECKED' && (
                <Text style={styles.caveat}>{t('fairness.ownSeedUnchecked')}</Text>
              )}
              {step === 3 && data.mine && (
                <OwnSeedCheck mine={data.mine} seatedClientSeeds={seatedClientSeeds} />
              )}

              {step === 6 && !link && <Text style={styles.caveat}>{t('fairness.notAnchored')}</Text>}
              {step === 6 && link && (
                <Text
                  style={styles.link}
                  onPress={() => void Linking.openURL(link)}
                  suppressHighlighting
                >
                  {t('fairness.viewOnChain')}
                </Text>
              )}
            </Card>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Step 3's own-seed check, shown alongside the step's overall badge above.
 *
 * `ownSeedAtSeat` (imported from `../fairness.ts`) is plain equality on
 * strings/numbers, no hashing — it runs identically here and in `verifyRound`
 * itself, so the two never disagree.
 */
function OwnSeedCheck({
  mine,
  seatedClientSeeds,
}: {
  mine: SeatedClientSeed;
  seatedClientSeeds: readonly SeatedClientSeed[];
}) {
  const { t } = useTranslation();
  const found = ownSeedAtSeat(seatedClientSeeds, mine);
  return (
    <View style={styles.ownSeedRow}>
      <Badge tone={found ? 'success' : 'warn'}>{found ? t('fairness.verified') : t('fairness.failed')}</Badge>
      <Text style={styles.mono} selectable numberOfLines={3}>
        {found ? `seat ${mine.seatOrder}: ${mine.clientSeed}` : `seat ${mine.seatOrder}: seed not found`}
      </Text>
    </View>
  );
}

function Value({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'ok' | 'bad' | 'neutral' }) {
  return (
    <View>
      <Text style={styles.valueLabel}>{label}</Text>
      <Text
        style={[styles.mono, tone === 'ok' ? styles.valueOk : tone === 'bad' ? styles.valueBad : null]}
        selectable
        numberOfLines={4}
      >
        {value || '—'}
      </Text>
    </View>
  );
}

/**
 * Which games we can honestly call tamper-proof, and which we cannot.
 * Ported from the web's `GameFairnessList` — no crypto involved, this
 * section is a full, faithful port with no gaps.
 */
function GameFairnessList() {
  const { t } = useTranslation();

  const lobby = useQuery({
    queryKey: ['lobby', 'games'],
    queryFn: () => api.get<{ games: LobbyGame[] }>('/lobby/games'),
    staleTime: 30_000,
  });

  const rtp = useQuery({
    queryKey: ['fairness', 'rtp'],
    queryFn: () => api.get<RtpFeed>('/fairness/rtp'),
    staleTime: 60_000,
    retry: 1,
  });

  const rtpByGame = new Map((rtp.data?.games ?? []).map((g) => [g.gameId, g]));

  const serverGames = (lobby.data?.games ?? []).filter((g) => !HIDDEN_GAMES.has(g.gameId));
  const rows: { id: string; fairness: FairnessTier; vendor?: string }[] =
    serverGames.length > 0
      ? serverGames.map((g) => ({ id: g.gameId, fairness: g.fairness, vendor: g.vendor }))
      : visibleGames().map((g) => ({ id: g.id, fairness: 'PROVABLE' as const }));

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{t('fairness.gameFairness')}</Text>

      {lobby.isPending && (
        <Card style={styles.listCard}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeletonRow}>
              <Skeleton width={140} />
              <Skeleton width={70} />
            </View>
          ))}
        </Card>
      )}

      {lobby.isError && (
        <Card>
          <ErrorState
            message={lobby.error instanceof Error ? lobby.error.message : t('states.error')}
            onRetry={() => lobby.refetch()}
            retryLabel={t('common.retry')}
          />
        </Card>
      )}

      {!lobby.isPending && !lobby.isError && (
        <Card style={styles.listCard}>
          {rows.map((g) => {
            const provable = g.fairness === 'PROVABLE';
            const rtpRow = rtpByGame.get(g.id);
            return (
              <View key={g.id} style={styles.gameRow}>
                <View style={styles.gameRowMain}>
                  <Text style={styles.gameName} numberOfLines={1}>
                    {t(`gameNames.${g.id}`, { defaultValue: g.id })}
                  </Text>
                  <Text style={styles.gameBlurb} numberOfLines={2}>
                    {provable ? t('fairness.provableBlurb') : t('fairness.vendorBlurb', { vendor: g.vendor ?? '' })}
                  </Text>
                  {rtpRow && rtpRow.actualRtp !== null && (
                    <Text style={styles.rtpLine} numberOfLines={1}>
                      {t('fairness.actualRate', { rate: rtpRow.actualRtp, count: rtpRow.sampleRounds })}
                      {rtpRow.theoreticalRtp ? ` · ${t('fairness.theoreticalRate', { rate: rtpRow.theoreticalRtp })}` : ''}
                    </Text>
                  )}
                </View>
                <Badge tone={provable ? 'success' : 'neutral'}>
                  {provable ? t('fairness.provable') : t('fairness.vendorAttested')}
                </Badge>
              </View>
            );
          })}
        </Card>
      )}

      <RuleStampCard stamp={rtp.data?.rules ?? null} />
    </View>
  );
}

/**
 * The rule-version stamp (feature queue #12) — ANCHORED / PUBLISHED / ABSENT.
 * Full port; pure data display, no crypto involved.
 */
function RuleStampCard({ stamp }: { stamp: RuleStampData | null }) {
  const { t } = useTranslation();

  if (!stamp) {
    return <Text style={styles.caveat}>{t('fairness.rulesAbsent')}</Text>;
  }

  const short = `${stamp.version.slice(0, 8)}…${stamp.version.slice(-6)}`;
  const anchored = Boolean(stamp.chainTx);

  return (
    <Card>
      <View style={styles.ruleStampHeader}>
        <Badge tone={anchored ? 'success' : 'neutral'}>
          {anchored ? t('fairness.rulesAnchored') : t('fairness.rulesPublished')}
        </Badge>
        <Text style={styles.mono} numberOfLines={1}>
          {short}
        </Text>
      </View>
      <Text style={styles.dim}>
        {anchored
          ? t('fairness.rulesAnchoredBlurb', {
              when: stamp.committedAt ? new Date(stamp.committedAt).toLocaleDateString() : '—',
            })
          : t('fairness.rulesPublishedBlurb')}
      </Text>
      {stamp.chainTx && (
        <Text style={styles.mono} selectable numberOfLines={2}>
          {stamp.chainTx}
        </Text>
      )}
    </Card>
  );
}

// ─── data shapes for /lobby/games and /fairness/rtp (duplicated locally —
// same cross-boundary reason as the fairness types above) ─────────────────

type FairnessTier = 'PROVABLE' | 'VENDOR_ATTESTED';

interface LobbyGame {
  gameId: string;
  fairness: FairnessTier;
  vendor?: string;
}

interface GameRtp {
  gameId: string;
  actualRtp: string | null;
  sampleRounds: number;
  theoreticalRtp: string | null;
}

interface RuleStampData {
  version: string;
  chainTx: string | null;
  committedAt: string | null;
}

interface RtpFeed {
  games: GameRtp[];
  rules?: RuleStampData | null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: space.lg, gap: space.md },
  introCard: { gap: 0 },
  introRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  introIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.card,
    backgroundColor: theme.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introIconText: { fontSize: 18 },
  introBody: { flex: 1, gap: 4 },
  title: { color: theme.text, fontSize: 15, fontWeight: '800' },
  dim: { color: theme.dim, fontSize: 12, lineHeight: 17 },
  section: { gap: space.sm },
  sectionLabel: { color: theme.dim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', paddingHorizontal: 4 },
  textArea: {
    minHeight: 120,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    color: theme.text,
    padding: space.md,
    fontSize: 12,
    fontFamily: 'monospace',
    textAlignVertical: 'top',
  },
  buttonRow: { flexDirection: 'row', gap: space.sm },
  buttonFlex: { flex: 1 },
  errorCard: { borderColor: theme.danger, backgroundColor: theme.surface },
  errorText: { color: theme.danger, fontSize: 12, lineHeight: 18 },
  mono: { color: theme.text, fontSize: 11, fontFamily: 'monospace' },
  bannerOk: { borderColor: theme.success, backgroundColor: theme.surface },
  bannerFail: { borderColor: theme.danger, backgroundColor: theme.surface },
  bannerRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  stepList: { gap: space.sm },
  stepCard: { gap: space.sm },
  stepHeader: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  stepHeaderText: { flex: 1, gap: 2 },
  stepTitle: { color: theme.text, fontSize: 13, fontWeight: '700' },
  stepBlurb: { color: theme.dim, fontSize: 11 },
  valueLabel: { color: theme.dim, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 },
  valueOk: { color: theme.success },
  valueBad: { color: theme.danger },
  caveat: { color: theme.dim, fontSize: 11, lineHeight: 16 },
  ownSeedRow: { gap: 4 },
  link: { color: theme.brand, fontSize: 11, fontWeight: '700' },
  listCard: { padding: 0, paddingHorizontal: space.md, gap: 0 },
  skeletonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space.sm,
  },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  gameRowMain: { flex: 1, gap: 2 },
  gameName: { color: theme.text, fontSize: 14, fontWeight: '600' },
  gameBlurb: { color: theme.dim, fontSize: 11 },
  rtpLine: { color: theme.dim, fontSize: 10 },
  ruleStampHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
