import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wand2, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useConfirmSheet } from '@/components/ui/ConfirmSheet';
import { useAdminUserMutations } from '@/api/hooks';
import { errorKey, adminErrorMessage } from '@/api/errors';
import type { PlayerOverride } from '@/api/admin';

/**
 * Admin — override a player's reputation score or VIP tier.
 *
 * These are DERIVED values: computed from rounds played, findings and settled
 * volume. Editing them therefore means one of two things, and only one is safe.
 * Rewriting the facts underneath — roundsPlayed, lifetime volume — would put a
 * history on the profile that the ledger cannot account for, which is the same
 * failure as typing in a balance. So this records a DECISION beside the
 * computation instead: the facts stay exactly as settled, and the override is
 * always visible, attributable and reversible.
 *
 * The computed value is shown next to the override for that reason. An override
 * that renders as an ordinary number is indistinguishable from an earned one,
 * and then nobody can tell a granted tier from a played-for one — including the
 * next administrator to look.
 */
const VIP_TIERS = ['V1', 'V2', 'V3', 'V4', 'V5'] as const;

/**
 * Reputation is a 0–1000 scale (FairPlay v5.9 §10.1), not 0–100.
 *
 * Written down because guessing it once already produced a silent, confusing
 * bug: a bound of 0–100 made every acceptable value a failing one, so setting
 * a player's score to 95 read as generous and delivered VERY_POOR — the worst
 * band on the platform.
 */
const MIN_SCORE = 0;
const MAX_SCORE = 1000;

export function OverrideEditor({
  playerId,
  override,
}: {
  playerId: string;
  override: PlayerOverride;
}) {
  const { t } = useTranslation();
  const { prompt, sheet } = useConfirmSheet();
  const m = useAdminUserMutations(playerId);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState(
    override.reputationScore === null ? '' : String(override.reputationScore),
  );

  const active = override.reputationScore !== null || override.vipTier !== null;

  const run = async (
    patch: { reputationScore?: number | null; vipTier?: string | null },
    title: string,
  ): Promise<void> => {
    setError(null);
    // A reason is required by the server, and asked for here rather than
    // discovered as a 400. An override has no round or settlement behind it —
    // the sentence written now is the whole record of why the number is what it
    // is, and it is what someone reads six months later.
    const reason = await prompt({
      title,
      body: 'This replaces a computed value. Say why — it is the only evidence this number will ever have.',
      confirmLabel: 'Apply',
      danger: true,
      withInput: { label: 'Reason', placeholder: 'Why this player, why now', required: true },
    });
    if (reason === null) return;
    try {
      await m.override.mutateAsync({ ...patch, reason });
    } catch (err) {
      setError(adminErrorMessage(err, t(errorKey(err))));
    }
  };

  return (
    <div className="rounded-(--radius-app) border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[0.6rem] uppercase tracking-wide text-dim">
          <Wand2 size={11} />
          Manual override
        </div>
        {active && <Badge tone="warn">active</Badge>}
      </div>

      {active && (
        <p className="mb-2.5 text-[0.62rem] leading-relaxed text-dim">
          Set by <span className="font-mono">{override.setBy}</span>
          {override.at && ` on ${new Date(override.at).toLocaleDateString()}`}
          {override.reason && <> — “{override.reason}”</>}
        </p>
      )}

      <div className="space-y-3">
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[0.62rem] font-semibold">Reputation score</span>
            {/* What they would have without the override. Always shown, so the
                two numbers can be compared rather than confused. */}
            <span className="text-[0.58rem] text-dim">computed: {override.computedScore}</span>
          </div>
          <div className="flex gap-1.5">
            <Input
              value={score}
              onChange={setScore}
              inputMode="numeric"
              placeholder={`${MIN_SCORE}–${MAX_SCORE}`}
            />
            <Button
              variant="secondary"
              onClick={() => {
                const n = Number(score);
                if (!Number.isInteger(n) || n < MIN_SCORE || n > MAX_SCORE) {
                  setError(
                    `Reputation score must be a whole number from ${MIN_SCORE} to ${MAX_SCORE}.`,
                  );
                  return;
                }
                void run({ reputationScore: n }, 'Override reputation score?');
              }}
              disabled={m.override.isPending || score.trim() === ''}
            >
              Set
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[0.62rem] font-semibold">VIP tier</span>
            <span className="text-[0.58rem] text-dim">computed: {override.computedTier}</span>
          </div>
          <div className="flex gap-1.5">
            {VIP_TIERS.map((tier) => (
              <button
                key={tier}
                onClick={() => void run({ vipTier: tier }, `Override VIP tier to ${tier}?`)}
                disabled={m.override.isPending}
                className={`flex-1 rounded-(--radius-app) border px-1 py-1.5 text-[0.62rem] font-semibold disabled:opacity-45 ${
                  override.vipTier === tier
                    ? 'border-brand bg-brand/15 text-brand'
                    : 'border-border text-dim active:bg-surface-2'
                }`}
              >
                {tier}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="mt-2 text-[0.66rem] text-danger">{error}</p>}

      {active && (
        <Button
          variant="ghost"
          className="mt-3"
          onClick={() => void run({ reputationScore: null, vipTier: null }, 'Remove the override?')}
          disabled={m.override.isPending}
        >
          <RotateCcw size={13} />
          Clear — go back to the computed values
        </Button>
      )}

      <p className="mt-2.5 text-[0.6rem] leading-relaxed text-dim">
        Rounds played, findings and lifetime volume are not changed by this — they are what
        actually happened. Only the score and tier shown to the player are replaced.
      </p>

      {sheet}
    </div>
  );
}
