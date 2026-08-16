import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { PokerTable } from '@/components/poker/PokerTable';
import { BaccaratFelt } from '@/components/games/BaccaratFelt';
import { NiuNiuFelt } from '@/components/games/NiuNiuFelt';
import { SanZhangFelt } from '@/components/games/SanZhangFelt';
import { RedPacketFelt } from '@/components/games/RedPacketFelt';
import { CowboyBeautyFelt } from '@/components/games/CowboyBeautyFelt';
import { DouDiZhuFelt } from '@/components/games/DouDiZhuFelt';
import { LotteryFelt } from '@/components/games/LotteryFelt';
import { SlotsFelt } from '@/components/games/SlotsFelt';
import { toView } from '@/hooks/useLiveTable';
import type { TableCommand, TableSnapshot } from '@/lib/liveTable';
import { DEMO_SCRIPTS } from './scripts';

/**
 * THROWAWAY DEMO — a walkthrough of every game, at `/demo`.
 *
 * Delete `src/demo/` and the one route in `router.tsx` and it is gone; nothing in the app imports
 * it. The screens below are the REAL game screens fed hand-written snapshots in the real wire
 * shape, so this shows how each game reads and plays without a server, an account or a chip. It is
 * a walkthrough, not a simulator: the outcomes are scripted and the controls are inert.
 */

type FeltComponent = (props: {
  snapshot?: TableSnapshot | null;
  onCommand?: (cmd: TableCommand) => void;
}) => React.ReactElement;

const FELTS: Record<string, FeltComponent> = {
  baccarat: BaccaratFelt,
  'niu-niu': NiuNiuFelt,
  'san-zhang': SanZhangFelt,
  'red-packet': RedPacketFelt,
  'cowboy-beauty': CowboyBeautyFelt,
  'dou-di-zhu': DouDiZhuFelt,
  lottery: LotteryFelt,
  slots: SlotsFelt,
};

const DEFAULT_HOLD_MS = 3_800;

export function DemoPage() {
  const [gameIndex, setGameIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);

  const script = DEMO_SCRIPTS[gameIndex]!;
  const current = script.steps[Math.min(step, script.steps.length - 1)]!;
  const lastStep = step >= script.steps.length - 1;

  const goToGame = useCallback((index: number) => {
    setGameIndex(index);
    setStep(0);
    setPlaying(true);
  }, []);

  // Auto-advance, then roll on to the next game — so it can be left running on a screen.
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (!lastStep) setStep((s) => s + 1);
      else goToGame((gameIndex + 1) % DEMO_SCRIPTS.length);
    }, current.holdMs ?? DEFAULT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [playing, current, lastStep, gameIndex, goToGame]);

  const Felt = FELTS[script.tableId];
  const view = useMemo(() => toView(current.snapshot), [current.snapshot]);

  return (
    <div className="flex min-h-full flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span className="rounded-full bg-[var(--brand)] px-2 py-0.5 text-[0.65rem] font-black tracking-wider text-white">
          DEMO
        </span>
        <div className="mr-auto">
          <div className="text-sm font-bold">{script.title}</div>
          <div className="text-[0.7rem] text-dim">{script.premise}</div>
        </div>
        <div className="text-[0.7rem] text-dim">
          Step {Math.min(step + 1, script.steps.length)} of {script.steps.length}
        </div>
      </header>

      {/* Game picker */}
      <nav className="flex flex-wrap gap-2 border-b border-border px-4 py-2">
        {DEMO_SCRIPTS.map((s, i) => (
          <button
            key={s.tableId}
            onClick={() => goToGame(i)}
            className={`rounded-full px-3 py-1 text-[0.7rem] font-semibold transition ${
              i === gameIndex ? 'bg-[var(--brand)] text-white' : 'bg-surface text-dim hover:text-text'
            }`}
          >
            {s.title.split(' · ')[0]}
          </button>
        ))}
      </nav>

      {/* The real screen for this game, driven by the script. */}
      <div className="flex min-h-[26rem] flex-1 items-center justify-center px-3 py-4">
        {Felt ? (
          <Felt snapshot={current.snapshot} />
        ) : (
          <PokerTable state={view} />
        )}
      </div>

      {/* What is happening */}
      <div className="border-t border-border px-4 py-3">
        <p className="mx-auto max-w-2xl text-center text-sm leading-relaxed">{current.caption}</p>
      </div>

      <div className="flex items-center justify-center gap-2 border-t border-border px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="grid size-9 place-items-center rounded-full border border-border bg-surface disabled:opacity-40"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={() => {
            setStep(0);
            setPlaying(false);
          }}
          className="grid size-9 place-items-center rounded-full border border-border bg-surface"
        >
          <RotateCcw size={15} />
        </button>
        <button
          onClick={() => {
            if (!lastStep) setStep((s) => s + 1);
            else goToGame((gameIndex + 1) % DEMO_SCRIPTS.length);
          }}
          className="grid size-9 place-items-center rounded-full border border-border bg-surface"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
