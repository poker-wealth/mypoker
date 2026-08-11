# Adding a live game (Dev B)

The blocker is gone: `TableHub` hosts any game through the `LiveRoom` interface + a registry, and money already settles for real through the rail (1 chip = ₮0.01) with no per-game work. Each new game is now a self-contained slice.

## Backend — make the game playable

1. **Write its room** — `src/live/<game>-room.ts`, a class implementing [`LiveRoom`](../game-server/src/live/live-room.ts) (`join` / `command` / `snapshotFor` / `summary` / `hasSeated` / `dispose`). It drives the already-built engine in `src/games/<game>/` and, when a hand ends, calls `deps.fc.settleTableHand(...)` — **never writes a balance itself** (iron rule #3). Use `PokerRoom` as the reference for the transport/seating/snapshot shape.
   - **Amounts are chips (integers).** The rail converts chips→USDT; do not touch USDT here.
   - **Banker games (Baccarat / Niu Niu / San Zhang):** settle player-funded — a *player* banks, the platform only rakes. Build the settlement request so `Σ(losers) = Σ(winners) + rake + Σ(jackpot)`; the platform is never a party.
   - **Fairness:** deal from the provably-fair shuffle the engine already uses; nothing extra for now (live notarization is a later, separate task).

2. **Register it** — one line in [`src/live/rooms.ts`](../game-server/src/live/rooms.ts):
   ```ts
   registerRoom('baccarat', (config, deps) => new BaccaratRoom(config as BaccaratRoomConfig, deps));
   ```

3. **Open a table** — add a config (with `game: '<id>'`) to `defaultTables()` in `src/live/server.ts`, or wherever tables are seeded.

That's the whole backend integration — the hub, transport, buy-in and settlement rail need no change.

## Frontend — make it reachable

4. **A table screen** — a component under `src/pages` / `src/components/<game>/` that renders the game's board and sends its commands over the socket. Reuse the `useLiveTable` hook and the `Table.tsx` wiring; the poker felt in `components/poker/` is the reference. The game's board art differs per game — that part is yours.

5. **Whitelist the id** — add the table id to `LIVE_TABLE_IDS` in `src/config.ts` so `Table.tsx` renders your screen instead of "NoTableYet".

## Rules that block a merge (Senior review)
- Money only via `deps.fc.*` — no balance writes in the room.
- Platform is never the banker (banker games settle player-funded).
- Amounts are integer chips; the rail owns the USDT boundary.
- One account, one table (the hub enforces this — don't fight it).

## Definition of done for a game
Registered + a table opens + two clients can sit, play a hand, and see their **real** balance change + conservation holds (Σ in = Σ out + rake + jackpot). The existing `test/regression/all-games.test.ts` conservation harness is the model for a room-level test.
