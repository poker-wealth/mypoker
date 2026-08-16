import { useState } from 'react';
import { motion } from 'motion/react';
import { Bot, User } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TableNotice } from './TableNotice';
import type { TableCommand, TableSnapshot } from '@/lib/liveTable';

export interface DouDiZhuFeltProps {
  snapshot?: TableSnapshot | null;
  onCommand?: (cmd: TableCommand) => void;
}

const RANK_SUIT_SYMBOLS: Record<string, string> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
};

function formatCard(card: string): { rank: string; suit: string; color: string } {
  if (card === 'js') return { rank: 'S', suit: '🃏', color: 'text-gray-300' };
  if (card === 'jb') return { rank: 'B', suit: '🃏', color: 'text-red-500' };
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  const isRed = suit === 'h' || suit === 'd';
  return {
    rank,
    suit: RANK_SUIT_SYMBOLS[suit] ?? suit,
    color: isRed ? 'text-red-500' : 'text-slate-100',
  };
}

export function DouDiZhuFelt({ snapshot, onCommand }: DouDiZhuFeltProps) {
  const [selectedCards, setSelectedCards] = useState<string[]>([]);

  const phase = snapshot?.phase ?? 'WAITING';
  const seats = snapshot?.seats ?? [];
  const youSeat = seats.find((s) => s.isYou);
  const myCards = (youSeat?.cards ?? []).filter((c): c is string => typeof c === 'string');
  const isMyTurn = youSeat != null && snapshot?.toActSeat === youSeat.index;
  // Bidding and card play are both IN_HAND; the server tells us which one we're in.
  const bidding = snapshot?.stage === 'BIDDING';
  const others = seats.filter((s) => s.playerId && !s.isYou);
  const board = snapshot?.board ?? [];

  const toggleCard = (card: string) => {
    setSelectedCards((prev) =>
      prev.includes(card) ? prev.filter((c) => c !== card) : [...prev, card],
    );
  };

  const handleAct = (type: string, amount?: number) => {
    onCommand?.({ kind: 'act', action: { type, ...(amount === undefined ? {} : { amount }) } });
    setSelectedCards([]);
  };

  const handlePlaySelected = () => {
    if (selectedCards.length === 0) return;
    // `cards` travels INSIDE the action — the wire schema drops anything hung off the command.
    onCommand?.({ kind: 'act', action: { type: 'play', cards: selectedCards } });
    setSelectedCards([]);
  };

  /** Take the first free chair. Dou Di Zhu deals at three, so the table waits until it has them. */
  const sitDown = () => {
    const free = seats.find((s) => !s.playerId);
    onCommand?.({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot?.minBuyIn ?? 1_000 });
  };

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-emerald-950 p-4 text-white select-none">
      {/* Background felt gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#064e3b_0%,#022c22_100%)] opacity-90" />

      {/* Header bar */}
      <div className="relative z-10 flex items-center justify-between border-b border-emerald-800/40 pb-2">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-wider text-amber-400">DOU DI ZHU</span>
          <span className="rounded bg-emerald-800/60 px-2 py-0.5 text-xs text-emerald-200">
            {phase}
          </span>
        </div>

        {/* Landlord 3 bonus cards display */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-emerald-300">Bonus Cards:</span>
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex h-10 w-7 items-center justify-center rounded border border-amber-500/40 bg-amber-950/40 text-xs font-bold text-amber-400"
              >
                🂠
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* The other two players — whoever they turn out to be. A chair is drawn as a bot only when
          the server says it is one; at a table of three people, none of them are. */}
      <div className="relative z-10 grid grid-cols-2 gap-4 px-6 pt-2">
        {others.map((seat) => (
          <div
            key={seat.index}
            className={`flex items-center justify-between rounded-xl border p-3 shadow-lg transition ${
              seat.index === snapshot?.toActSeat
                ? 'border-amber-400 bg-amber-950/30 ring-2 ring-amber-400/50'
                : 'border-emerald-700/50 bg-emerald-900/30'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-full border border-emerald-600 bg-emerald-800">
                {seat.isBot ? (
                  <Bot className="h-6 w-6 text-emerald-200" />
                ) : (
                  <User className="h-6 w-6 text-emerald-200" />
                )}
                {seat.isDealer && (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-xs">
                    👑
                  </span>
                )}
              </div>
              <div>
                <div className="text-sm font-semibold">{seat.name}</div>
                <div className="text-xs text-emerald-300">
                  {seat.isDealer ? 'Landlord' : 'Peasant'}
                  {seat.isBot ? ' · AI' : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-amber-300">{seat.cards.length} Cards</span>
            </div>
          </div>
        ))}
      </div>

      {/* Center Trick Table Felt */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center py-4">
        <div className="flex min-h-[120px] w-full max-w-lg items-center justify-center rounded-2xl border border-emerald-600/30 bg-emerald-900/20 p-4 shadow-inner">
          {board.length > 0 ? (
            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-1">
                {board.map((card, idx) => {
                  const { rank, suit, color } = formatCard(card);
                  return (
                    <motion.div
                      key={idx}
                      initial={{ scale: 0.8, y: -10 }}
                      animate={{ scale: 1, y: 0 }}
                      className="flex h-16 w-11 flex-col justify-between rounded-lg border border-slate-300 bg-white p-1 shadow-md"
                    >
                      <span className={`text-xs font-bold ${color}`}>{rank}</span>
                      <span className={`self-center text-sm ${color}`}>{suit}</span>
                    </motion.div>
                  );
                })}
              </div>
              {snapshot?.message && (
                <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-300">
                  {snapshot.message}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-emerald-400/60">Trick Area</span>
          )}
        </div>
      </div>

      {/* My Hand Cards Area (Bottom) */}
      <div className="relative z-10 flex flex-col items-center gap-4 pb-2">
        <div className="flex min-h-[90px] max-w-full items-center justify-center gap-1 overflow-x-auto p-2">
          {myCards.map((card, idx) => {
            const isSelected = selectedCards.includes(card);
            const { rank, suit, color } = formatCard(card);
            return (
              <motion.div
                key={idx}
                onClick={() => toggleCard(card)}
                animate={{ y: isSelected ? -16 : 0 }}
                className={`flex h-20 w-14 cursor-pointer flex-col justify-between rounded-xl border p-1.5 shadow-md transition ${
                  isSelected ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-400' : 'border-slate-300 bg-white'
                }`}
              >
                <span className={`text-sm font-bold ${color}`}>{rank}</span>
                <span className={`self-center text-lg ${color}`}>{suit}</span>
              </motion.div>
            );
          })}
        </div>

        {/* Controls. Which ones you get depends on the stage the server reports: you cannot bid
            during a trick, and you cannot play a card during the auction. */}
        <div className="flex min-h-[2.25rem] items-center gap-3">
          {phase === 'IN_HAND' && isMyTurn && bidding && (
            <>
              <span className="text-xs text-emerald-300">Bid for the landlord’s chair:</span>
              {[0, 1, 2, 3].map((points) => (
                <Button
                  key={points}
                  variant={points === 0 ? 'secondary' : 'primary'}
                  size="sm"
                  onClick={() => handleAct(`bid-${points}`)}
                >
                  {points === 0 ? 'Pass' : points}
                </Button>
              ))}
            </>
          )}

          {phase === 'IN_HAND' && isMyTurn && !bidding && (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={board.length === 0}
                onClick={() => handleAct('pass')}
              >
                Pass
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={selectedCards.length === 0}
                onClick={handlePlaySelected}
              >
                Play Selected ({selectedCards.length})
              </Button>
            </>
          )}

          {phase === 'IN_HAND' && !isMyTurn && youSeat && (
            <span className="text-xs text-emerald-300/70">Waiting for the other players…</span>
          )}

          {phase !== 'IN_HAND' && !youSeat && (
            <Button variant="primary" size="sm" onClick={sitDown}>
              Sit &amp; Start Game
            </Button>
          )}

          {/* Seated at a table that cannot deal yet — say who it is waiting for. */}
          {phase === 'WAITING' && youSeat && <TableNotice snapshot={snapshot} />}

          {phase === 'SHOWDOWN' && youSeat && (
            <span className="text-xs text-amber-300">{snapshot?.message ?? 'Hand over'}</span>
          )}
        </div>
      </div>
    </div>
  );
}
