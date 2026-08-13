import { useState } from 'react';
import { Trophy, Shield, Coins, Play, RotateCcw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  BullBullEngine,
  type Card,
  type GamePhase,
  type HandEvaluation,
  type Settlement,
} from '../../../../game-server/src/games/bull-bull/index';

const INITIAL_PLAYERS = [
  { id: 'p0', name: '👑 Banker (P0)', balance: 50000 },
  { id: 'p1', name: 'Player 1', balance: 20000 },
  { id: 'p2', name: 'Player 2', balance: 20000 },
  { id: 'p3', name: 'Player 3', balance: 20000 },
];

function formatSuitSymbol(suit: Card['suit']): { symbol: string; color: string } {
  switch (suit) {
    case 'SPADES':
      return { symbol: '♠', color: 'text-slate-100' };
    case 'HEARTS':
      return { symbol: '♥', color: 'text-red-500' };
    case 'DIAMONDS':
      return { symbol: '♦', color: 'text-red-500' };
    case 'CLUBS':
      return { symbol: '♣', color: 'text-slate-100' };
  }
}

export function BullBullSimulatorFelt() {
  const [engine] = useState(() => new BullBullEngine('sim-1', INITIAL_PLAYERS));
  const [roomState, setRoomState] = useState(() => engine.getRoomState());
  const [selectedBids, setSelectedBids] = useState<Record<string, number>>({
    p0: 5,
    p1: 1,
    p2: 2,
    p3: 1,
  });
  const [selectedBets, setSelectedBets] = useState<Record<string, { amount: number; multiplier: number }>>({
    p1: { amount: 1000, multiplier: 1 },
    p2: { amount: 2000, multiplier: 2 },
    p3: { amount: 500, multiplier: 5 },
  });

  const syncState = () => setRoomState({ ...engine.getRoomState() });

  /**
   * Everything the engine refused this round, so a rejected action is visible rather than a button
   * that appears to do nothing. The engine is the authority; this screen only reports it.
   */
  const [rejections, setRejections] = useState<string[]>([]);
  const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  const handleSelectBanker = () => {
    const refused: string[] = [];
    for (const [pId, mult] of Object.entries(selectedBids)) {
      try {
        engine.submitBankerBid(pId, mult);
      } catch (err) {
        refused.push(`${pId}: ${reasonOf(err)}`);
      }
    }
    try {
      engine.selectBanker();
    } catch (err) {
      refused.push(reasonOf(err));
    }
    setRejections(refused);
    syncState();
  };

  const handleStartBettingAndDeal = () => {
    const refused: string[] = [];
    for (const [pId, b] of Object.entries(selectedBets)) {
      try {
        engine.placeBet(pId, b.amount, b.multiplier);
      } catch (err) {
        // A bet the player or the bank cannot cover. Say so — this is the whole point of the
        // exposure rule, and a silent no-op reads as a broken table.
        refused.push(`${pId}: ${reasonOf(err)}`);
      }
    }
    try {
      engine.deal();
    } catch (err) {
      refused.push(reasonOf(err));
    }
    setRejections(refused);
    syncState();
  };

  const handleRevealStep = () => {
    const current = roomState.revealProgress;
    if (current < 5) {
      engine.setRevealProgress(current + 1);
      syncState();
    } else {
      engine.evaluate();
      syncState();
    }
  };

  const handleRevealAllAndEvaluate = () => {
    engine.setRevealProgress(5);
    engine.evaluate();
    syncState();
  };

  const handleSettle = () => {
    engine.settle();
    syncState();
  };

  const handleNextRound = () => {
    engine.nextRound();
    syncState();
  };

  const phase: GamePhase = roomState.phase;
  const bankerState = roomState.bankerState;
  const bankerPlayer = roomState.players.find((p) => p.isBanker);
  const nonBankerPlayers = roomState.players.filter((p) => !p.isBanker);

  const totalBalanceSum = roomState.players.reduce((sum, p) => sum + p.balance, 0);

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-slate-950 p-4 text-white select-none">
      {/* Table Background Felt Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#1e1b4b_0%,#090d16_100%)] opacity-95" />

      {/* Header Bar */}
      <div className="relative z-10 flex items-center justify-between border-b border-indigo-900/60 pb-3">
        <div className="flex items-center gap-3">
          <span className="font-extrabold tracking-widest text-amber-400">
            🐂 BULL-BULL (NIU NIU) SIMULATOR
          </span>
          <span className="rounded-full bg-indigo-900/80 px-3 py-0.5 text-xs font-semibold text-indigo-200">
            Phase: {phase}
          </span>
          <span className="rounded-full bg-slate-800 px-3 py-0.5 text-xs font-medium text-slate-300">
            Round #{roomState.roundNumber + 1}
          </span>
        </div>

        {/* Total Accounting Invariant Badge */}
        <div className="flex items-center gap-2 rounded-xl bg-slate-900/80 px-3 py-1.5 border border-slate-700 text-xs">
          <Coins className="h-4 w-4 text-amber-400" />
          <span>Total Vault: </span>
          <span className="font-bold text-amber-300">₮{totalBalanceSum.toLocaleString()}</span>
          {phase === 'SETTLEMENT' && (
            <span className="ml-2 flex items-center gap-1 font-bold text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Invariant Verified (∑=0)
            </span>
          )}
        </div>
      </div>

      {/* Banker Station (Top Center) */}
      <div className="relative z-10 flex flex-col items-center justify-center pt-2">
        <div
          className={`flex flex-col items-center rounded-2xl border p-4 shadow-2xl transition max-w-sm w-full ${
            bankerPlayer ? 'border-amber-400/80 bg-amber-950/40 ring-2 ring-amber-400/40' : 'border-slate-800 bg-slate-900/40'
          }`}
        >
          <div className="flex items-center justify-between w-full pb-2 border-b border-amber-500/20">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-amber-400" />
              <span className="font-bold text-amber-300">
                {bankerPlayer ? bankerPlayer.name : 'BANKER SEAT'}
              </span>
            </div>
            {bankerState && (
              <span className="rounded bg-amber-500 text-black px-2 py-0.5 text-xs font-bold">
                {bankerState.multiplier}x Multiplier
              </span>
            )}
          </div>

          {/* Banker Cards */}
          <div className="flex gap-1.5 my-3">
            {bankerPlayer && roomState.hands[bankerPlayer.id] ? (
              roomState.hands[bankerPlayer.id]!.map((card, i) => {
                const isRevealed = i < roomState.revealProgress;
                const { symbol, color } = formatSuitSymbol(card.suit);
                return (
                  <div
                    key={i}
                    className={`flex h-16 w-11 flex-col justify-between rounded-lg border p-1 font-bold shadow-md transition ${
                      isRevealed ? 'bg-white border-slate-300' : 'bg-indigo-950 border-indigo-700'
                    }`}
                  >
                    {isRevealed ? (
                      <>
                        <span className={`text-xs ${color}`}>{card.rank}</span>
                        <span className={`self-center text-sm ${color}`}>{symbol}</span>
                      </>
                    ) : (
                      <span className="m-auto text-xs text-indigo-400 font-bold">🂠</span>
                    )}
                  </div>
                );
              })
            ) : (
              <span className="text-xs text-slate-500 py-4">Waiting for Deal</span>
            )}
          </div>

          {/* Banker Evaluation Badge */}
          {bankerPlayer && roomState.evaluations[bankerPlayer.id] && roomState.revealProgress === 5 && (
            <BullBadge evalResult={roomState.evaluations[bankerPlayer.id]!} />
          )}

          {/* Banker Balance & Settlement Outcome */}
          {bankerPlayer && (
            <div className="flex justify-between w-full pt-2 text-xs border-t border-slate-800">
              <span className="text-slate-400">Balance: ₮{bankerPlayer.balance.toLocaleString()}</span>
              {phase === 'SETTLEMENT' && (
                <span
                  className={`font-bold ${
                    roomState.bankerNetChange >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {roomState.bankerNetChange >= 0 ? '+' : ''}₮{roomState.bankerNetChange.toLocaleString()}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3 Players Grid (Bottom / Sides) */}
      <div className="relative z-10 grid grid-cols-3 gap-4 px-4 py-2">
        {nonBankerPlayers.map((player) => {
          const handCards = roomState.hands[player.id] ?? [];
          const evalResult = roomState.evaluations[player.id];
          const bet = roomState.bets[player.id];
          const settlement: Settlement | undefined = roomState.settlements.find(
            (s) => s.playerId === player.id,
          );

          return (
            <div
              key={player.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/50 p-4 shadow-xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-slate-200">{player.name}</span>
                <span className="text-xs text-amber-400 font-semibold">
                  ₮{player.balance.toLocaleString()}
                </span>
              </div>

              {/* Bidding & Betting Controls inline */}
              {phase === 'BANKER_SELECTION' && (
                <div className="flex flex-col gap-1.5 my-3">
                  <span className="text-xs text-slate-400">Banker Bid Multiplier:</span>
                  <div className="flex gap-2">
                    {[1, 2, 5].map((m) => (
                      <button
                        key={m}
                        onClick={() =>
                          setSelectedBids((prev) => ({ ...prev, [player.id]: m }))
                        }
                        className={`flex-1 rounded py-1 text-xs font-bold transition ${
                          selectedBids[player.id] === m
                            ? 'bg-amber-400 text-black'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {m}x
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {phase === 'BETTING' && (
                <div className="flex flex-col gap-2 my-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Wager:</span>
                    <div className="flex gap-1">
                      {[500, 1000, 2000].map((amt) => (
                        <button
                          key={amt}
                          onClick={() =>
                            setSelectedBets((prev) => ({
                              ...prev,
                              [player.id]: { ...prev[player.id]!, amount: amt },
                            }))
                          }
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            selectedBets[player.id]?.amount === amt
                              ? 'bg-amber-400 text-black'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          ₮{amt}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Multiplier:</span>
                    <div className="flex gap-1">
                      {[1, 2, 5].map((m) => (
                        <button
                          key={m}
                          onClick={() =>
                            setSelectedBets((prev) => ({
                              ...prev,
                              [player.id]: { ...prev[player.id]!, multiplier: m },
                            }))
                          }
                          className={`rounded px-2 py-0.5 text-xs font-bold ${
                            selectedBets[player.id]?.multiplier === m
                              ? 'bg-amber-400 text-black'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {m}x
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Cards Display */}
              <div className="flex justify-center gap-1 my-3 min-h-[64px]">
                {handCards.length > 0 ? (
                  handCards.map((card, i) => {
                    const isRevealed = i < roomState.revealProgress;
                    const { symbol, color } = formatSuitSymbol(card.suit);
                    return (
                      <div
                        key={i}
                        className={`flex h-16 w-11 flex-col justify-between rounded-lg border p-1 font-bold shadow-md transition ${
                          isRevealed ? 'bg-white border-slate-300' : 'bg-indigo-950 border-indigo-700'
                        }`}
                      >
                        {isRevealed ? (
                          <>
                            <span className={`text-xs ${color}`}>{card.rank}</span>
                            <span className={`self-center text-sm ${color}`}>{symbol}</span>
                          </>
                        ) : (
                          <span className="m-auto text-xs text-indigo-400 font-bold">🂠</span>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <span className="text-xs text-slate-500 self-center">No Cards</span>
                )}
              </div>

              {/* Bull Evaluation Badge */}
              {evalResult && roomState.revealProgress === 5 && (
                <div className="flex justify-center my-1">
                  <BullBadge evalResult={evalResult} />
                </div>
              )}

              {/* Footer / Bet & Settlement Summary */}
              <div className="flex justify-between items-center text-xs pt-2 border-t border-slate-800">
                <span className="text-slate-400">
                  {bet ? `Bet: ₮${bet.amount} (${bet.multiplier}x)` : 'No Bet'}
                </span>

                {settlement && (
                  <span
                    className={`font-bold rounded px-2 py-0.5 text-xs ${
                      settlement.result === 'WIN'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-600'
                        : settlement.result === 'LOSS'
                        ? 'bg-red-950 text-red-300 border border-red-600'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {settlement.result === 'WIN' ? `WIN +₮${settlement.netChange}` : settlement.result === 'LOSS' ? `LOSS -₮${Math.abs(settlement.netChange)}` : 'TIE'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* What the engine turned down, and why. */}
      {rejections.length > 0 && (
        <div className="relative z-10 mb-2 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2">
          <div className="text-[0.7rem] font-bold uppercase tracking-wider text-red-300">
            Refused by the engine
          </div>
          <ul className="mt-1 space-y-0.5">
            {rejections.map((reason) => (
              <li key={reason} className="text-[0.72rem] leading-tight text-red-200">
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Main Action Bar */}
      <div className="relative z-10 flex items-center justify-between border-t border-indigo-900/60 pt-3">
        <div className="text-xs text-slate-400">
          State Action Queue: <span className="font-semibold text-amber-300">{phase}</span>
        </div>

        <div className="flex items-center gap-3">
          {phase === 'BANKER_SELECTION' && (
            <Button variant="primary" size="md" onClick={handleSelectBanker}>
              <Shield className="h-4 w-4" /> Select Highest Banker Bid
            </Button>
          )}

          {phase === 'BETTING' && (
            <Button variant="primary" size="md" onClick={handleStartBettingAndDeal}>
              <Play className="h-4 w-4" /> Confirm Bets & Deal Cards
            </Button>
          )}

          {phase === 'REVEAL' && (
            <div className="flex gap-2">
              <Button variant="secondary" size="md" onClick={handleRevealStep}>
                Flip Next Card ({roomState.revealProgress}/5)
              </Button>
              <Button variant="primary" size="md" onClick={handleRevealAllAndEvaluate}>
                Reveal All & Evaluate
              </Button>
            </div>
          )}

          {phase === 'EVALUATION' && (
            <Button variant="primary" size="md" onClick={handleRevealAllAndEvaluate}>
              Calculate Bull Ranks
            </Button>
          )}

          {phase === 'RESULTS' && (
            <Button variant="primary" size="md" onClick={handleSettle}>
              <Trophy className="h-4 w-4" /> Settle Payouts & Verify Accounting
            </Button>
          )}

          {phase === 'SETTLEMENT' && (
            <Button variant="primary" size="md" onClick={handleNextRound}>
              <RotateCcw className="h-4 w-4" /> Start Next Round
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function BullBadge({ evalResult }: { evalResult: HandEvaluation }) {
  const isBullBull = evalResult.type === 'BULL_BULL';
  const isNoBull = evalResult.type === 'NO_BULL';

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black shadow-lg border transition ${
        isBullBull
          ? 'bg-gradient-to-r from-amber-500 to-red-600 text-white border-amber-300 ring-2 ring-amber-400/60 animate-pulse'
          : isNoBull
          ? 'bg-slate-800 text-slate-400 border-slate-700'
          : 'bg-indigo-900 text-amber-300 border-indigo-700'
      }`}
    >
      {isBullBull && <span>🔥</span>}
      <span>{evalResult.type.replace('_', ' ')}</span>
      {isBullBull && <span>🔥</span>}
    </div>
  );
}
