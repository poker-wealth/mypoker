import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Crown, RotateCcw, User } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  DouDiZhuMatch,
  type MatchState,
} from '../../../../game-server/src/games/dou-di-zhu/match';
import { cardRank } from '../../../../game-server/src/games/dou-di-zhu/ddz-deck';
import { classifyPlay, ComboType } from '../../../../game-server/src/games/dou-di-zhu/combos';
import {
  chooseBestMove,
  evaluateBidding,
  type AiDifficulty,
} from '../../../../game-server/src/games/dou-di-zhu/ai';

/**
 * Dou Di Zhu against two house AI opponents.
 *
 * A simulator: play chips do not exist here, nothing settles, and no money path is involved — the
 * live money tables deliberately have no bots. Every rule decision belongs to `DouDiZhuMatch`;
 * this screen sends card selections and renders what it is told. When the match refuses a play,
 * the reason it gives is what appears on screen — the UI never decides that a move was illegal.
 */

const YOU = 'you';
const AI_ONE = 'ai-1';
const AI_TWO = 'ai-2';

const SUIT_FACE: Record<string, { symbol: string; red: boolean }> = {
  s: { symbol: '♠', red: false },
  h: { symbol: '♥', red: true },
  d: { symbol: '♦', red: true },
  c: { symbol: '♣', red: false },
};

function faceOf(card: string): { rank: string; suit: string; red: boolean; joker: boolean } {
  if (card === 'js') return { rank: 'JOKER', suit: '🃏', red: false, joker: true };
  if (card === 'jb') return { rank: 'JOKER', suit: '🃏', red: true, joker: true };
  const rank = card.slice(0, -1) === 'T' ? '10' : card.slice(0, -1);
  const suit = SUIT_FACE[card.slice(-1)] ?? { symbol: '?', red: false };
  return { rank, suit: suit.symbol, red: suit.red, joker: false };
}

/** How a played combination should be announced (§25). */
function announce(cards: string[]): string {
  const combo = classifyPlay(cards.map(cardRank));
  if (!combo) return '';
  if (combo.type === ComboType.Rocket) return '🚀 ROCKET!';
  if (combo.type === ComboType.Bomb) return '🔥 BOMB!';
  return combo.type.replace(/[+-]/g, ' ').toUpperCase();
}

function PlayingCard({
  card,
  selected,
  onClick,
}: {
  card: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const { rank, suit, red, joker } = faceOf(card);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`relative flex h-24 w-16 shrink-0 flex-col justify-between rounded-xl border p-1.5 shadow-lg transition-all duration-150 ${
        selected
          ? '-translate-y-4 border-amber-400 bg-amber-50 ring-2 ring-amber-400'
          : 'border-slate-300 bg-white hover:-translate-y-1'
      } ${joker ? 'bg-gradient-to-br from-white to-amber-100' : ''} ${
        onClick ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      <span className={`text-sm font-black leading-none ${red ? 'text-red-600' : 'text-slate-900'}`}>
        {rank}
      </span>
      <span className={`self-center text-2xl leading-none ${red ? 'text-red-600' : 'text-slate-900'}`}>
        {suit}
      </span>
      <span
        className={`rotate-180 text-sm font-black leading-none ${red ? 'text-red-600' : 'text-slate-900'}`}
      >
        {rank}
      </span>
    </button>
  );
}

function Opponent({
  state,
  playerId,
  thinking,
}: {
  state: MatchState;
  playerId: string;
  thinking: boolean;
}) {
  const player = state.players.find((p) => p.id === playerId)!;
  const isLandlord = state.landlordId === playerId;
  const onClock = state.currentPlayerId === playerId && state.gameStatus === 'PLAYING';
  const lastEvent = [...state.history].reverse().find((e) => e.playerId === playerId);

  return (
    <div
      className={`flex min-w-[10rem] items-center gap-3 rounded-xl border p-3 transition ${
        onClock ? 'border-amber-400 bg-amber-950/30 ring-2 ring-amber-400/40' : 'border-white/10 bg-black/30'
      }`}
    >
      <div className="relative grid size-11 place-items-center rounded-full bg-emerald-900">
        <Bot className="size-6 text-emerald-200" />
        {isLandlord && (
          <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-amber-500 text-[0.6rem]">
            👑
          </span>
        )}
      </div>
      <div className="leading-tight">
        <div className="text-sm font-bold">{player.name}</div>
        <div className="text-[0.7rem] text-emerald-300">
          {isLandlord ? 'LANDLORD' : 'PEASANT'} · {player.hand.length} cards
        </div>
        <div className="text-[0.7rem] text-white/60">
          {thinking && onClock ? 'thinking…' : lastEvent?.kind === 'PASS' ? 'passed' : ' '}
        </div>
      </div>
    </div>
  );
}

export function DouDiZhuSimulatorFelt() {
  const [difficulty, setDifficulty] = useState<AiDifficulty>('MEDIUM');
  const matchRef = useRef<DouDiZhuMatch>(newMatch());
  const [state, setState] = useState<MatchState>(() => matchRef.current.getState());
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>('Bid for the landlord’s chair.');
  const [banner, setBanner] = useState<string>('');
  const [thinking, setThinking] = useState(false);

  const sync = useCallback(() => setState(matchRef.current.getState()), []);

  const restart = useCallback(() => {
    matchRef.current = newMatch();
    setSelected([]);
    setBanner('');
    setNotice('Bid for the landlord’s chair.');
    setState(matchRef.current.getState());
  }, []);

  /**
   * The house seats take their turns on a timer, so the table reads at human speed. Every decision
   * is the engine's: `chooseBestMove` picks from moves the match itself calls legal.
   */
  useEffect(() => {
    const match = matchRef.current;
    if (state.gameStatus === 'LANDLORD_WON' || state.gameStatus === 'PEASANTS_WON') return;

    const actorId =
      state.gameStatus === 'BIDDING' ? state.bidState.currentBidderId : state.currentPlayerId;
    if (!actorId || actorId === YOU) return;

    setThinking(true);
    const timer = setTimeout(() => {
      try {
        if (state.gameStatus === 'BIDDING') {
          const points = evaluateBidding(match.handOf(actorId), difficulty);
          match.bid(actorId, points);
          setNotice(`${nameOf(state, actorId)} ${points === 0 ? 'passed' : `bid ${points}`}.`);
        } else {
          const toBeat = match.mustBeat(actorId);
          const move = chooseBestMove(match.handOf(actorId), toBeat, difficulty, {
            isLandlord: match.getState().landlordId === actorId,
            landlordPlayerId: match.getState().landlordId ?? '',
            myPlayerId: actorId,
            opponentCardCounts: match.cardCounts(),
          });

          if (move && move.length > 0) {
            match.play(actorId, move);
            setBanner(announce(move));
            setNotice(`${nameOf(state, actorId)} played ${move.map(label).join(' ')}.`);
          } else {
            match.pass(actorId);
            setNotice(`${nameOf(state, actorId)} passed.`);
          }
        }
      } catch (err) {
        // The engine refused the AI's move: report it rather than leaving a table that never moves.
        setNotice(`${nameOf(state, actorId)} could not move — ${(err as Error).message}`);
      }
      setThinking(false);
      sync();
    }, 850);

    return () => clearTimeout(timer);
  }, [state, difficulty, sync]);

  const yourHand = useMemo(() => {
    const you = state.players.find((p) => p.id === YOU);
    return you ? you.hand : [];
  }, [state]);

  const yourTurn = state.currentPlayerId === YOU && state.gameStatus === 'PLAYING';
  const yourBid = state.gameStatus === 'BIDDING' && state.bidState.currentBidderId === YOU;
  const over = state.gameStatus === 'LANDLORD_WON' || state.gameStatus === 'PEASANTS_WON';
  const youAreLandlord = state.landlordId === YOU;

  const toggle = (card: string) =>
    setSelected((prev) => (prev.includes(card) ? prev.filter((c) => c !== card) : [...prev, card]));

  const playSelected = () => {
    if (selected.length === 0) {
      setNotice('Select the cards you want to play.');
      return;
    }
    try {
      matchRef.current.play(YOU, selected);
      setBanner(announce(selected));
      setNotice(`You played ${selected.map(label).join(' ')}.`);
      setSelected([]);
      sync();
    } catch (err) {
      // Straight from the engine: "does not beat the current table play", and so on.
      setNotice((err as Error).message);
    }
  };

  const passTurn = () => {
    try {
      matchRef.current.pass(YOU);
      setNotice('You passed.');
      setSelected([]);
      sync();
    } catch (err) {
      setNotice((err as Error).message);
    }
  };

  const bid = (points: number) => {
    try {
      matchRef.current.bid(YOU, points);
      setNotice(points === 0 ? 'You passed on the bank.' : `You bid ${points}.`);
      sync();
    } catch (err) {
      setNotice((err as Error).message);
    }
  };

  const table = state.lastCombination;

  return (
    <div className="relative flex min-h-screen flex-col justify-between overflow-hidden bg-emerald-950 p-4 text-white select-none">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#064e3b_0%,#022c22_100%)] opacity-90" />

      {/* Header */}
      <div className="relative z-10 flex flex-wrap items-center gap-3 border-b border-emerald-800/40 pb-3">
        <span className="font-black tracking-wider text-amber-400">DOU DI ZHU</span>
        <span className="rounded bg-emerald-800/60 px-2 py-0.5 text-xs text-emerald-200">
          {state.gameStatus}
        </span>
        <span className="text-xs text-emerald-300">
          Bonus cards:{' '}
          {state.bonusRevealed ? state.bonusCards.map(label).join(' ') : '🂠 🂠 🂠'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-emerald-300">AI:</span>
          {(['EASY', 'MEDIUM', 'HARD'] as const).map((level) => (
            <button
              key={level}
              onClick={() => setDifficulty(level)}
              className={`rounded px-2 py-1 text-xs font-semibold transition ${
                difficulty === level ? 'bg-amber-500 text-black' : 'bg-emerald-900/60 text-emerald-200'
              }`}
            >
              {level}
            </button>
          ))}
          <Button variant="secondary" size="sm" onClick={restart}>
            <RotateCcw className="size-3.5" /> New game
          </Button>
        </div>
      </div>

      {/* Opponents */}
      <div className="relative z-10 flex flex-wrap justify-between gap-3 pt-3">
        <Opponent state={state} playerId={AI_ONE} thinking={thinking} />
        <Opponent state={state} playerId={AI_TWO} thinking={thinking} />
      </div>

      {/* The table */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 py-6">
        {banner && (
          <div className="animate-pulse rounded-full bg-amber-500/20 px-4 py-1 text-sm font-black tracking-wider text-amber-300">
            {banner}
          </div>
        )}

        <div className="flex min-h-[7rem] items-center justify-center gap-1 rounded-2xl border border-emerald-600/30 bg-emerald-900/20 px-6 py-4">
          {table ? (
            table.cards.map((card) => <PlayingCard key={card} card={card} />)
          ) : (
            <span className="text-xs text-emerald-400/60">
              {state.gameStatus === 'BIDDING' ? 'Bidding for the landlord' : 'Trick is open — lead anything'}
            </span>
          )}
        </div>

        <p className="min-h-[1.25rem] text-center text-sm text-emerald-100">{notice}</p>

        {over && (
          <div className="rounded-xl border border-amber-400 bg-amber-950/40 px-6 py-3 text-center">
            <div className="text-lg font-black text-amber-300">
              {state.gameStatus === 'LANDLORD_WON' ? 'LANDLORD WINS' : 'PEASANTS WIN'}
            </div>
            <div className="text-xs text-emerald-200">
              {(state.gameStatus === 'LANDLORD_WON') === youAreLandlord ? 'You won.' : 'You lost.'}
            </div>
          </div>
        )}
      </div>

      {/* Your seat */}
      <div className="relative z-10 flex flex-col items-center gap-3 border-t border-emerald-800/40 pt-3">
        <div className="flex items-center gap-2 text-xs text-emerald-300">
          <div className="grid size-8 place-items-center rounded-full bg-emerald-900">
            <User className="size-4 text-emerald-200" />
          </div>
          <span className="font-bold text-white">You</span>
          {state.landlordId && (
            <span className="flex items-center gap-1 rounded bg-emerald-800/60 px-2 py-0.5">
              {youAreLandlord && <Crown className="size-3 text-amber-400" />}
              {youAreLandlord ? 'LANDLORD' : 'PEASANT'}
            </span>
          )}
          <span>{yourHand.length} cards</span>
        </div>

        <div className="flex max-w-full flex-wrap items-end justify-center gap-1 overflow-x-auto pb-2 pt-4">
          {yourHand.map((card) => (
            <PlayingCard
              key={card}
              card={card}
              selected={selected.includes(card)}
              {...(yourTurn ? { onClick: () => toggle(card) } : {})}
            />
          ))}
        </div>

        <div className="flex min-h-[2.5rem] items-center gap-3 pb-2">
          {yourBid && (
            <>
              <span className="text-xs text-emerald-300">Bid for the bank:</span>
              {[0, 1, 2, 3].map((points) => (
                <Button
                  key={points}
                  variant={points === 0 ? 'secondary' : 'primary'}
                  size="sm"
                  onClick={() => bid(points)}
                >
                  {points === 0 ? 'Pass' : points}
                </Button>
              ))}
            </>
          )}

          {yourTurn && (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={!matchRef.current.mustBeat(YOU)}
                onClick={passTurn}
              >
                Pass
              </Button>
              <Button variant="primary" size="sm" disabled={selected.length === 0} onClick={playSelected}>
                Play {selected.length > 0 ? `(${selected.length})` : ''}
              </Button>
            </>
          )}

          {!yourTurn && !yourBid && !over && (
            <span className="text-xs text-emerald-300/70">Waiting for the other players…</span>
          )}

          {over && (
            <Button variant="primary" size="sm" onClick={restart}>
              Play again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function newMatch(): DouDiZhuMatch {
  return new DouDiZhuMatch([
    { id: YOU, name: 'You' },
    { id: AI_ONE, name: 'AI Opponent 1' },
    { id: AI_TWO, name: 'AI Opponent 2' },
  ]);
}

function nameOf(state: MatchState, playerId: string): string {
  return state.players.find((p) => p.id === playerId)?.name ?? playerId;
}

/** '3c' → '3♣', 'js' → 🃏 — for the running commentary, not the cards themselves. */
function label(card: string): string {
  const { rank, suit } = faceOf(card);
  return rank === 'JOKER' ? suit : `${rank}${suit}`;
}
