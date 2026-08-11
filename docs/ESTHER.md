# Esther — task list

Your focus is making the games playable for real money. The foundation is already in: live tables settle through the real ledger (1 chip = ₮0.01), and any game can be hosted by implementing the `LiveRoom` interface and registering it. Each game is a self-contained slice — you won't touch the money plumbing.

**Work in this order. Ask questions any time, and take the time to read and understand a game before you build it — that's expected, not a delay.**

## Read first
- `docs/ADDING_A_GAME.md` — the exact recipe (backend room → register → open a table → frontend screen → whitelist the id).
- `game-server/src/live/live-room.ts` — the `LiveRoom` interface you implement.
- `game-server/src/live/poker-room.ts` — the reference room. Copy its shape for transport, seating and snapshots.
- The engine for whatever game you're on: `game-server/src/games/<game>/`. These are already written and tested — you're wiring them to a live table, not writing game logic.

## Tasks, in order
1. **Short Deck + Omaha** — Texas variants; reuse `PokerRoom`. Add their table configs, register them, add the table screens, and whitelist the ids. Quick win that teaches you the flow end to end.
2. **After a hand settles, refetch the balance** on the frontend (`/me/balance`) so the wallet/header reflect the win or loss. Small, but it completes the play loop — do it early.
3. **Baccarat** — your first non-poker room. A player banks, the platform only rakes; settle player-funded so `Σ(losers) = Σ(winners) + rake + jackpot`.
4. **Niu Niu** — banker-claim window (the engine already handles the atomic claim).
5. **San Zhang** — three-card compare, player-funded like Baccarat.
6. **Red Packet Minesweeper** — grid revealed after bets.
7. **Cowboy & Beauty** — pari-mutuel pools with a T-5s odds freeze (a timer in the room).
8. **Dou Di Zhu** — bidding then play. Two things to fix first: the engine reuses a fixed round id (needs a per-hand counter), and there's no settlement test yet — add one.
9. **Lottery** — pari-mutuel draw.
10. **Slots** — wire the third-party adapter money path. Check with the owner first: in-house vs external provider is still open.
11. **Jackpot on every table** — the jackpot *hit* engine currently fires for Texas only; generalize it so all tables can arm and pay the four tiers. The money movement here is reviewed by the senior.

For each game: a room + register (one line) + a table opens + a frontend screen + the id whitelisted + a room-level conservation test (see `test/regression/all-games.test.ts` for the pattern).

## Rules that block a merge
- Money moves **only** through `deps.fc.*` — a room never writes a balance.
- The **platform is never the banker** — banker games settle player-funded.
- Amounts are **integer chips**; the rail owns the USDT boundary.
- One account, one table — the hub enforces it; don't work around it.

Branch per task off `main`, open a PR, and the senior reviews before it merges. Keep PRs to one game each.
