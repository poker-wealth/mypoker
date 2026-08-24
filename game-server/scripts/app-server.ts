import express, { type Request, type Response } from 'express';
import { join } from 'node:path';
import { seedLobby } from '../src/lobby/dev-seed';
import { GAME_IDS, gameSpec, type GameId } from '../src/lobby/game-catalog';
import { createTable, startHand, act, viewFor, type TableVariantId } from './table-runtime';
import type { Action } from '../src/games/texas/betting';
import { demoWallet } from './wallet-runtime';
import { playBetting, betOptionsFor, type BettingGameId } from './betting-runtime';
import { playCowboy, playLottery, playSlots } from './fast-runtime';
import { newRound as newRedPacket, reveal as revealRedPacket } from './redpacket-runtime';
import {
  createDdz,
  bid as ddzBid,
  playCards as ddzPlay,
  passTurn as ddzPass,
  viewFor as ddzView,
  isLegalSelection as ddzLegal,
} from './ddz-runtime';

/**
 * The FairPlay app server — serves the Telegram Mini App and the lobby API it reads.
 *
 * The API returns REAL data from the LobbyService (the same one the tests cover), not fixtures. The
 * frontend is a genuine Telegram Mini App: it uses the Telegram WebApp SDK for theme + viewport and
 * degrades to a plain browser page when opened outside Telegram, so it can be demoed either way.
 *
 *   npm run app   →   http://localhost:4100
 */

const PORT = Number(process.env.PORT ?? 4100);

const lobby = seedLobby();

/** How the games are grouped on the lobby rail (per the layout agreed with the owner). */
const GROUPS: { title: string; icon: string; games: GameId[] }[] = [
  { title: 'Poker', icon: '♠', games: ['texas', 'short-deck', 'omaha'] },
  { title: 'Card Games', icon: '🀄', games: ['dou-di-zhu', 'niu-niu', 'baccarat', 'san-zhang'] },
  { title: 'Fast', icon: '⚡', games: ['red-packet', 'cowboy-beauty', 'lottery', 'slots'] },
];

const app = express();

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(join(__dirname, 'app', 'index.html'));
});
app.use('/static', express.static(join(__dirname, 'app')));

app.get('/api/lobby', (_req: Request, res: Response) => {
  const summaries = lobby.listGames();
  const byId = new Map(summaries.map((s) => [s.gameId, s]));
  const groups = GROUPS.map((g) => ({
    title: g.title,
    icon: g.icon,
    games: g.games.map((id) => byId.get(id)!).filter(Boolean),
  }));
  res.json({
    totalJackpot: lobby.totalJackpot(),
    grandTicker: Math.max(...summaries.map((s) => s.jackpot)), // biggest single pool, for the hero
    provableCount: GAME_IDS.filter((id) => gameSpec(id).fairness === 'PROVABLE').length,
    totalGames: GAME_IDS.length,
    groups,
  });
});

app.get('/api/tables', (req: Request, res: Response) => {
  const gameId = req.query.gameId as GameId | undefined;
  res.json({ tables: lobby.listTables(gameId ? { gameId } : {}) });
});

// ── Live Texas table (you + 2 bots), driven by the real engine ────────────────
app.use(express.json());

app.post('/api/play/new', (req: Request, res: Response) => {
  const variant = ((req.body?.variant as string) ?? 'texas') as TableVariantId;
  const allowed: TableVariantId[] = ['texas', 'omaha', 'short-deck'];
  const tableId = createTable(allowed.includes(variant) ? variant : 'texas');
  startHand(tableId)
    .then(() => res.json(viewFor(tableId)))
    .catch((e: Error) => res.status(500).json({ error: e.message }));
});

app.post('/api/play/:tableId/action', (req: Request, res: Response) => {
  const tableId = String(req.params.tableId);
  const { type, amount } = req.body as { type: string; amount?: number };
  const action = { type, ...(amount !== undefined ? { amount } : {}) } as Action;
  act(tableId, action)
    .then(() => res.json(viewFor(tableId)))
    .catch((e: Error) => res.status(400).json({ error: e.message }));
});

app.get('/api/play/:tableId', (req: Request, res: Response) => {
  try {
    res.json(viewFor(String(req.params.tableId)));
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

// ── Wallet (mirrors the Financial Core's rules; the real engine is the FC) ─────
/** A fixed demo deposit address, as a player would see. */
const DEPOSIT_ADDRESS = 'TU4vFa8p2C6DdemoAddr9xkLmNpQr7sWvY';

function walletState(): Record<string, unknown> {
  return { balances: demoWallet.balances(), total: demoWallet.total(), history: demoWallet.history() };
}

app.get('/api/wallet', (_req: Request, res: Response) => {
  res.json({ ...walletState(), depositAddress: DEPOSIT_ADDRESS });
});

app.post('/api/wallet/deposit', (req: Request, res: Response) => {
  try {
    const { amount } = req.body as { amount: number };
    const tx = demoWallet.startDeposit(amount);
    demoWallet.confirmDeposit(tx.id); // demo: confirm immediately (real deposits wait 20 blocks)
    res.json(walletState());
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post('/api/wallet/withdraw', (req: Request, res: Response) => {
  try {
    const { amount } = req.body as { amount: number };
    const tx = demoWallet.requestWithdrawal(amount);
    demoWallet.advanceWithdrawal(tx.id); // → BROADCASTING
    demoWallet.advanceWithdrawal(tx.id); // → CONFIRMED (funds leave the platform)
    res.json(walletState());
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ── Player-banked betting games (Baccarat / Niu Niu / San Zhang) ──────────────
const BETTING_GAMES: BettingGameId[] = ['baccarat', 'niu-niu', 'san-zhang'];

app.get('/api/bet/:game/options', (req: Request, res: Response) => {
  const game = String(req.params.game) as BettingGameId;
  if (!BETTING_GAMES.includes(game)) return res.status(404).json({ error: 'unknown game' });
  return res.json({ betOptions: betOptionsFor(game) });
});

app.post('/api/bet/:game', (req: Request, res: Response) => {
  const game = String(req.params.game) as BettingGameId;
  if (!BETTING_GAMES.includes(game)) return res.status(404).json({ error: 'unknown game' });
  const { amount, side } = req.body as { amount: number; side: string };
  return playBetting(game, amount, side ?? 'hand')
    .then((result) => res.json(result))
    .catch((e: Error) => res.status(400).json({ error: e.message }));
});

// ── Fast games (Cowboy & Beauty / Lottery / Slots) ────────────────────────────
app.post('/api/fast/cowboy-beauty', (req: Request, res: Response) => {
  const { amount, side } = req.body as { amount: number; side: 'COWBOY' | 'BEAUTY' };
  playCowboy(side ?? 'COWBOY', amount)
    .then((r) => res.json(r))
    .catch((e: Error) => res.status(400).json({ error: e.message }));
});

app.post('/api/fast/lottery', (req: Request, res: Response) => {
  const { amount, pick } = req.body as { amount: number; pick: number };
  playLottery(pick ?? 0, amount)
    .then((r) => res.json(r))
    .catch((e: Error) => res.status(400).json({ error: e.message }));
});

app.post('/api/fast/slots', (req: Request, res: Response) => {
  const { amount } = req.body as { amount: number };
  playSlots(amount)
    .then((r) => res.json(r))
    .catch((e: Error) => res.status(400).json({ error: e.message }));
});

// ── Red Packet Minesweeper (grid committed BEFORE the bet) ────────────────────
app.post('/api/redpacket/new', (_req: Request, res: Response) => {
  res.json(newRedPacket());
});

app.post('/api/redpacket/:roundId/reveal', (req: Request, res: Response) => {
  const { cell, amount } = req.body as { cell: number; amount: number };
  revealRedPacket(String(req.params.roundId), cell, amount)
    .then((r) => res.json(r))
    .catch((e: Error) => res.status(400).json({ error: e.message }));
});

app.listen(PORT, () => {
  console.log(`\n  FairPlay Mini App running — open  http://localhost:${PORT}\n`);
  console.log('  Lobby data is live from the real LobbyService.\n');
});

// ── Dou Di Zhu (Landlord) ─────────────────────────────────────────────────────
app.post('/api/ddz/new', (_req: Request, res: Response) => {
  createDdz()
    .then((id) => res.json(ddzView(id)))
    .catch((e: Error) => res.status(500).json({ error: e.message }));
});

app.get('/api/ddz/:id', (req: Request, res: Response) => {
  try {
    res.json(ddzView(String(req.params.id)));
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

app.post('/api/ddz/:id/bid', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { points } = req.body as { points: number };
  ddzBid(id, points)
    .then(() => res.json(ddzView(id)))
    .catch((e: Error) => res.status(400).json({ error: e.message }));
});

app.post('/api/ddz/:id/play', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { cards } = req.body as { cards: string[] };
  ddzPlay(id, cards)
    .then(() => res.json(ddzView(id)))
    .catch((e: Error) => res.status(400).json({ error: e.message }));
});

app.post('/api/ddz/:id/pass', (req: Request, res: Response) => {
  const id = String(req.params.id);
  ddzPass(id)
    .then(() => res.json(ddzView(id)))
    .catch((e: Error) => res.status(400).json({ error: e.message }));
});

app.post('/api/ddz/:id/check', (req: Request, res: Response) => {
  const { cards } = req.body as { cards: string[] };
  try {
    res.json({ legal: ddzLegal(String(req.params.id), cards) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
