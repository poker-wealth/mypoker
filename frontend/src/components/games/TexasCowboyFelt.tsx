import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayingCard } from '@/components/poker/PlayingCard';
import type { TableCommand, TableSnapshot } from '@/lib/liveTable';

export type PokerHandType =
  | 'HIGH_CARD'
  | 'ONE_PAIR'
  | 'TWO_PAIR'
  | 'THREE_OF_A_KIND'
  | 'STRAIGHT'
  | 'FLUSH'
  | 'FULL_HOUSE'
  | 'FOUR_OF_A_KIND'
  | 'STRAIGHT_FLUSH'
  | 'ROYAL_FLUSH';

export interface TexasCowboyRound {
  id: string;
  roundNumber: number;
  phase: string;
  bettingWindow: { openedAt: number; closesAt: number } | null;
  cowboy: {
    holeCards: string[];
    evaluation: { type: PokerHandType; displayName: string } | null;
  };
  cowgirl: {
    holeCards: string[];
    evaluation: { type: PokerHandType; displayName: string } | null;
  };
  communityCards: string[];
  markets: { id: string; multiplier: number }[];
  result: {
    winner: 'COWBOY' | 'COWGIRL' | 'TIE';
    winningHandType: PokerHandType | null;
  } | null;
}

export function TexasCowboyFelt({
  snapshot,
  onCommand,
}: {
  snapshot?: TableSnapshot | null;
  onCommand?: (cmd: TableCommand) => void;
}) {
  // The round arrives in its own field. It used to be JSON stuffed into `message` — the line the
  // result banner prints — which put the whole round state on screen as text.
  if (!snapshot) return <></>;
  const tcRound = (snapshot.gameState as TexasCowboyRound | undefined) ?? null;

  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [selectedAmount, setSelectedAmount] = useState<number>(100);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);

  if (!tcRound) {
    return <div className="text-white text-center mt-10">Waiting for next round...</div>;
  }

  // Calculate remaining time
  const closesAt = snapshot.actionDeadline ?? tcRound.bettingWindow?.closesAt ?? 0;
  const remaining = Math.max(0, closesAt - now);
  const remainingSeconds = (remaining / 1000).toFixed(1);

  const phase = tcRound.phase;
  const isBettingOpen = phase === 'BETTING_OPEN';

  const placeBet = () => {
    if (!selectedMarket || selectedAmount <= 0 || !onCommand) return;
    onCommand({
      kind: 'act',
      action: { type: 'bet', amount: selectedAmount, selection: selectedMarket },
    });
    setSelectedMarket(null);
  };

  const getMarketMultiplier = (marketId: string) => {
    return tcRound.markets.find((m) => m.id === marketId)?.multiplier ?? 0;
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-between text-white overflow-hidden pb-4">
      {/* HEADER */}
      <div className="text-center pt-2">
        <h1 className="text-2xl font-black text-amber-500 uppercase tracking-widest drop-shadow-md">
          Texas Cowboy
        </h1>
        <p className="text-xs text-amber-200/60 font-bold uppercase tracking-wider">
          Round #{tcRound.roundNumber}
        </p>
      </div>

      {/* AVATARS & HOLE CARDS */}
      <div className="flex w-full max-w-4xl justify-between px-8 relative">
        {/* Cowboy */}
        <div className="flex flex-col items-center">
          <div className="text-4xl mb-2 drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]">🤠</div>
          <h2 className="text-lg font-black text-amber-400">COWBOY</h2>
          <div className="flex gap-1 mt-2">
            {tcRound.cowboy.holeCards.length > 0 ? (
              tcRound.cowboy.holeCards.map((c: string, i: number) => <PlayingCard key={i} card={c} size="sm" />)
            ) : (
              <div className="flex gap-1">
                <div className="w-[3rem] h-[4rem] rounded-md border border-white/20 bg-slate-800/80" />
                <div className="w-[3rem] h-[4rem] rounded-md border border-white/20 bg-slate-800/80" />
              </div>
            )}
          </div>
          {tcRound.cowboy.evaluation && (
            <div className="mt-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
              {tcRound.cowboy.evaluation.displayName}
            </div>
          )}
        </div>

        {/* Community Board */}
        <div className="flex flex-col items-center justify-center pt-4">
          <div className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-widest">
            Community Cards
          </div>
          <div className="flex gap-2 bg-black/40 p-3 rounded-xl border border-white/10 shadow-2xl">
            {tcRound.communityCards.length > 0 ? (
              tcRound.communityCards.map((c: string, i: number) => <PlayingCard key={i} card={c} size="md" />)
            ) : (
              <div className="flex gap-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="w-[4rem] h-[5.5rem] rounded-md border border-white/10 bg-slate-800/50" />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cowgirl */}
        <div className="flex flex-col items-center">
          <div className="text-4xl mb-2 drop-shadow-[0_0_10px_rgba(236,72,153,0.8)]">🤠</div>
          <h2 className="text-lg font-black text-pink-400">COWGIRL</h2>
          <div className="flex gap-1 mt-2">
            {tcRound.cowgirl.holeCards.length > 0 ? (
              tcRound.cowgirl.holeCards.map((c: string, i: number) => <PlayingCard key={i} card={c} size="sm" />)
            ) : (
              <div className="flex gap-1">
                <div className="w-[3rem] h-[4rem] rounded-md border border-white/20 bg-slate-800/80" />
                <div className="w-[3rem] h-[4rem] rounded-md border border-white/20 bg-slate-800/80" />
              </div>
            )}
          </div>
          {tcRound.cowgirl.evaluation && (
            <div className="mt-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
              {tcRound.cowgirl.evaluation.displayName}
            </div>
          )}
        </div>
      </div>

      {/* RESULTS OVERLAY */}
      <AnimatePresence>
        {tcRound.result && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0, y: -20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.5, opacity: 0 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 text-center bg-black/80 backdrop-blur-md px-12 py-8 rounded-3xl border-2 border-amber-500 shadow-[0_0_50px_rgba(245,158,11,0.5)]"
          >
            <h1 className="text-6xl font-black text-white drop-shadow-lg uppercase tracking-tight">
              {tcRound.result.winner === 'TIE' ? 'TIE' : `${tcRound.result.winner} WINS!`}
            </h1>
            {tcRound.result.winningHandType && (
              <div className="mt-4 text-2xl font-bold text-amber-400">
                {tcRound.result.winningHandType.replace(/_/g, ' ')}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* BETTING BOARD */}
      <div className="w-full max-w-4xl px-4 mt-6">
        <div className="flex justify-between items-end mb-2 px-2">
          <div className="text-lg font-black uppercase text-slate-300">
            {isBettingOpen ? 'Place Your Bets' : 'Bets Closed'}
          </div>
          <div
            className={`text-2xl font-black tabular-nums font-mono ${
              remaining > 3000 ? 'text-emerald-400' : remaining > 0 ? 'text-red-500 animate-pulse' : 'text-slate-500'
            }`}
          >
            {isBettingOpen ? remainingSeconds : '0.0'}s
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 bg-black/50 p-4 rounded-2xl border border-white/10">
          {/* WINNER CATEGORY */}
          <div className="col-span-3 grid grid-cols-3 gap-3">
            {['cowboy_win', 'cowgirl_win', 'tie'].map((id) => (
              <button
                key={id}
                disabled={!isBettingOpen}
                onClick={() => setSelectedMarket(id)}
                className={`relative flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all overflow-hidden ${
                  selectedMarket === id
                    ? 'border-amber-400 bg-amber-400/20'
                    : 'border-white/10 bg-slate-800/80 hover:bg-slate-700 disabled:opacity-50 disabled:hover:bg-slate-800'
                }`}
              >
                <span className="font-bold uppercase tracking-wider text-sm">
                  {id.replace('_', ' ')}
                </span>
                <span className="text-amber-400 font-black font-mono">
                  {getMarketMultiplier(id)}x
                </span>
              </button>
            ))}
          </div>

          {/* HAND TYPES */}
          <div className="col-span-3 grid grid-cols-5 gap-2 mt-2">
            {[
              'high_card',
              'one_pair',
              'two_pair',
              'three_of_a_kind',
              'straight',
              'flush',
              'full_house',
              'four_of_a_kind',
              'straight_flush',
              'royal_flush',
            ].map((id) => (
              <button
                key={id}
                disabled={!isBettingOpen}
                onClick={() => setSelectedMarket(id)}
                className={`relative flex flex-col items-center justify-center py-2 px-1 rounded-lg border-2 transition-all ${
                  selectedMarket === id
                    ? 'border-amber-400 bg-amber-400/20'
                    : 'border-white/10 bg-slate-900/80 hover:bg-slate-800 disabled:opacity-50'
                }`}
              >
                <span className="text-[0.6rem] font-bold uppercase tracking-widest text-slate-300">
                  {id.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-amber-400 font-bold font-mono">
                  {getMarketMultiplier(id)}x
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* BET CONTROLS */}
        <div className="flex items-center gap-4 mt-4 bg-slate-900 p-3 rounded-2xl border border-white/5">
          <div className="flex gap-2">
            {[100, 500, 1000, 5000].map((amt) => (
              <button
                key={amt}
                onClick={() => setSelectedAmount(amt)}
                className={`w-12 h-12 rounded-full border-[3px] font-bold text-xs shadow-lg ${
                  selectedAmount === amt
                    ? 'border-amber-400 bg-slate-800 text-amber-400'
                    : 'border-slate-600 bg-slate-800 text-slate-400 hover:border-slate-400'
                }`}
              >
                {amt}
              </button>
            ))}
          </div>

          <div className="flex-1 text-center">
            {selectedMarket && (
              <div className="text-xs font-bold text-emerald-400 uppercase">
                Return: {selectedAmount * getMarketMultiplier(selectedMarket)}
              </div>
            )}
          </div>

          <button
            disabled={!isBettingOpen || !selectedMarket}
            onClick={placeBet}
            className="px-8 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 font-black uppercase text-white shadow-lg shadow-orange-500/20 disabled:opacity-50 disabled:grayscale active:scale-95 transition-transform"
          >
            CONFIRM BET
          </button>
        </div>
      </div>
    </div>
  );
}
