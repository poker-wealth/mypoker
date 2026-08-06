import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, ShieldCheck, ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { verifyRound, type RoundVerificationData, type VerificationResult, type StepId } from '@/lib/fairness';
import { cn } from '@/lib/cn';
import sampleRound from '@/lib/__fixtures__/round-vector.json';

/**
 * Fairness verification — the 6-step verifier from the v6.0 UltraFair spec.
 *
 * Everything runs in this browser. The page never asks the server whether a hand
 * was fair, because an answer from the platform is worth nothing: it is the party
 * you are checking. It takes the round's published data, recomputes every hash,
 * and shows you both values when they disagree.
 *
 * Which is why the failure detail matters as much as the verdict. "Step 2 failed"
 * is an accusation; two hashes side by side is evidence.
 */

const STEP_KEYS: Record<StepId, { title: string; blurb: string }> = {
  1: { title: 'fairness.step1', blurb: 'fairness.step1Blurb' },
  2: { title: 'fairness.step2', blurb: 'fairness.step2Blurb' },
  3: { title: 'fairness.step3', blurb: 'fairness.step3Blurb' },
  4: { title: 'fairness.step4', blurb: 'fairness.step4Blurb' },
  5: { title: 'fairness.step5', blurb: 'fairness.step5Blurb' },
  6: { title: 'fairness.step6', blurb: 'fairness.step6Blurb' },
};

export function Fairness() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (raw: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const parsed = JSON.parse(raw) as RoundVerificationData;
      setResult(await verifyRound(parsed));
    } catch (err) {
      // Includes malformed JSON and malformed hex. A corrupt input is NOT a
      // failed verification — saying so would accuse the platform on the strength
      // of a typo.
      setError(err instanceof Error ? err.message : t('fairness.badInput'));
    } finally {
      setBusy(false);
    }
  };

  const loadSample = (): void => {
    const text = JSON.stringify(sampleRound, null, 2);
    setInput(text);
    void run(text);
  };

  return (
    <div className="space-y-4">
      <section className="rounded-(--radius-app) border border-border bg-surface p-4">
        <div className="flex items-start gap-3">
          <div
            className="grid size-10 shrink-0 place-items-center rounded-xl text-white"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          >
            <ShieldCheck size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold">{t('fairness.title')}</h1>
            <p className="mt-1 text-xs leading-relaxed text-dim">{t('fairness.intro')}</p>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <label htmlFor="round-data" className="px-1 text-xs font-bold uppercase tracking-wide text-dim">
          {t('fairness.roundData')}
        </label>
        <textarea
          id="round-data"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('fairness.paste')}
          spellCheck={false}
          className="h-36 w-full resize-y rounded-(--radius-app) border border-border bg-surface p-3 font-mono text-[0.7rem] text-text placeholder:text-dim"
        />
        <div className="flex gap-2">
          <Button className="flex-1" disabled={!input.trim() || busy} onClick={() => void run(input)}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : t('fairness.verify')}
          </Button>
          <Button variant="ghost" onClick={loadSample} disabled={busy}>
            {t('fairness.sample')}
          </Button>
        </div>
      </section>

      {error && (
        <div className="rounded-(--radius-app) border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {t('fairness.couldNotRead')} <span className="font-mono">{error}</span>
        </div>
      )}

      {result && (
        <>
          <div
            className={cn(
              'flex items-center gap-3 rounded-(--radius-app) border p-4',
              result.allPass
                ? 'border-success/40 bg-success/10'
                : 'border-danger/40 bg-danger/10',
            )}
          >
            <div
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-full',
                result.allPass ? 'bg-success' : 'bg-danger',
              )}
            >
              {result.allPass ? <Check size={18} className="text-white" /> : <X size={18} className="text-white" />}
            </div>
            <div className="min-w-0">
              <div className={cn('font-bold', result.allPass ? 'text-success' : 'text-danger')}>
                {result.allPass ? t('fairness.verified') : t('fairness.failed')}
              </div>
              <div className="text-xs text-dim">
                {result.allPass ? t('fairness.verifiedBlurb') : t('fairness.failedBlurb')}
              </div>
            </div>
          </div>

          <ul className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
            {result.steps.map((s) => (
              <StepRow
                key={s.step}
                index={s.step}
                pass={s.pass}
                title={t(STEP_KEYS[s.step].title)}
                blurb={t(STEP_KEYS[s.step].blurb)}
                computed={s.computed}
                expected={s.expected}
                computedLabel={t('fairness.computed')}
                expectedLabel={t('fairness.expected')}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function StepRow({
  index,
  pass,
  title,
  blurb,
  computed,
  expected,
  computedLabel,
  expectedLabel,
}: {
  index: number;
  pass: boolean;
  title: string;
  blurb: string;
  computed: string;
  expected: string;
  computedLabel: string;
  expectedLabel: string;
}) {
  // A failed step opens by default — the evidence is the reason to be here.
  const [open, setOpen] = useState(!pass);

  return (
    <li>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
      >
        <div
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-full',
            pass ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
          )}
        >
          {pass ? <Check size={14} /> : <X size={14} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {index}. {title}
          </div>
          <div className="truncate text-[0.66rem] text-dim">{blurb}</div>
        </div>
        <ChevronDown
          size={16}
          className={cn('shrink-0 text-dim transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="space-y-2 border-t border-border bg-bg/40 px-4 py-3">
          <Value label={computedLabel} value={computed} tone={pass ? 'ok' : 'bad'} />
          <Value label={expectedLabel} value={expected} tone="neutral" />
        </div>
      )}
    </li>
  );
}

function Value({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'bad' | 'neutral' }) {
  return (
    <div>
      <div className="text-[0.6rem] uppercase tracking-wide text-dim">{label}</div>
      <div
        className={cn(
          'break-all font-mono text-[0.66rem]',
          tone === 'ok' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-text',
        )}
      >
        {value}
      </div>
    </div>
  );
}
