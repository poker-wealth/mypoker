# 02 · Architecture

## The monorepo

One repo, three packages, orchestrated by root `package.json` scripts:

```
poker/
  financial-core/   The money.   Node + TypeScript, Express + MongoDB (Mongoose) + Redis.
  game-server/      The games.   Node + TypeScript, ws (WebSocket) + Express + zod.
  frontend/         The app.      React 19 + Vite + Tailwind (see doc 04).
  docker-compose.yml   Local infra: MongoDB replica set + Redis.
  PROJECT_PLAN.md      The master schedule to launch.
  package.json         Root orchestration (install:all, test, verify, dev, web, app, smoke…).
  *.docx               The product specs (reference).
```

Root commands you'll use constantly:

```bash
npm run install:all   # install all three packages
npm test              # run financial-core + game-server test suites
npm run verify        # typecheck + lint + test (both backend packages)
npm run app           # run the game-server HTTP+WS runtime
npm run web           # run the game-server web demo
npm run dev           # run the frontend (Vite)
npm run smoke         # financial-core smoke test
```

## How the pieces talk

```
   ┌────────────┐   HTTPS + WebSocket    ┌──────────────┐   HTTP /api/v1        ┌────────────────┐
   │  frontend  │ ─────────────────────► │ game-server  │ ────────────────────► │ financial-core │
   │ (Mini App) │ ◄───────────────────── │  (gateway +  │ ◄──────────────────── │   (the money)  │
   └────────────┘   game state / lobby   │   games)     │  settle / balances    └───────┬────────┘
                                         └──────────────┘   (INTERNAL_API_SECRET)        │
                                                                             MongoDB (RS) │ Redis
                                                                            ledger/txns    │ locks/idempotency
```

- The **frontend talks only to `game-server`** (HTTP for lobby/wallet reads, WebSocket for live
  gameplay). It never talks to `financial-core` directly.
- **`game-server` is the gateway.** It authenticates players, runs the games, and — whenever
  money must move — calls `financial-core` over an internal HTTP API (`/api/v1`) guarded by a
  shared secret (`INTERNAL_API_SECRET`).
- **`financial-core` owns all money.** It's the only thing that writes the ledger, and it does
  so inside MongoDB transactions (hence the replica-set requirement). Redis holds idempotency
  keys and risk/settlement locks.
- **Player JWTs:** issued at login (HS256), attached by the client, verified by both services
  (`JWT_SECRET`). See the auth task in [06-week-plan.md](06-week-plan.md).

## financial-core (the money)

- **Stack:** Express, Mongoose (MongoDB), ioredis (Redis), zod, bson. Runs on **port 4001**.
  Entry: `src/index.ts`. Internal API under **`/api/v1`**.
- **Key domains** (folders under `src/`):
  - `domain/` — account & ledger types (double-entry accounting, Decimal128 amounts).
  - `clearing/` — `ClearingRules`: the ONLY sanctioned path to move money (`transfer()`).
  - `deposit/` — TRC-20 (USDT) deposits, HD address derivation, crediting.
  - `settlement/` — the settlement engine (pot/side-pot settlement, `settlePots`).
  - `circuit-breakers/` — CB1–CB7 (illegal-fund-flow, anomaly, security-event breakers).
  - `reinsurance/` — insurance/reinsurance pools.
  - `db/` — Mongo connection + transaction helpers (hard 50ms txn budget).
  - `http/` — the `/api/v1` app, internal-auth middleware, error model.
  - `config/`, `lib/` — env loading, logger, small utilities.
- **Non-negotiable:** every balance change goes through `transfer()` → `ClearingRules` →
  double-entry ledger. Nothing writes a balance directly. (Iron rule #1.)

## game-server (the games)

- **Stack:** `ws` (WebSocket), Express (the runtime/gateway), zod. TypeScript via `ts-node`.
  Entry: `src/index.ts`; the runnable HTTP+WS gateway is `scripts/app-server.ts` (`npm run app`).
- **Framework primitives** (shared by every game): `EventBus`, `StateMachine`, `TurnManager`,
  `RoomManager`, `BaseGame`, and `GameService` (the live-hand orchestrator). A
  `FinancialCoreClient` is the bridge to `financial-core`.
- **Lobby:** `src/lobby/` — `LobbyService` and `game-catalog.ts` (`GAME_IDS`, per-game spec).
  This catalog is the server-side source of truth the frontend lobby should eventually read.
- **Games:** each game is a folder under `src/games/` on the state-machine pattern — e.g.
  `texas/` (hand-evaluator, betting, pots), `dou-di-zhu/`, `niu-niu/`, `san-zhang/`,
  `baccarat/`, plus the fast games (Red Packet, Cowboy & Beauty, Lottery, Slots) and the
  Texas variants (Short Deck, Omaha). `src/jackpot/` holds the tiered jackpot logic.
- **Provably-fair v6.0:** server/client/future-block seeds, deterministic shuffle, Merkle
  aggregation, and a multi-step verifier — wired into the live hand.
- **The `scripts/` runtimes** (`table-runtime`, `betting-runtime`, `fast-runtime`,
  `redpacket-runtime`, `wallet-runtime`, `app-server`, `web-demo`) are demo/runner harnesses
  that exercise the games. They're the closest thing to "how a hand is driven" and are a good
  read before wiring the frontend to the live server.

## A hand, end to end

1. Client joins a table over **WebSocket** (authenticated with the player JWT).
2. `game-server` deals using the **provably-fair** shuffle (commit before, reveal after) —
   **no blockchain in the critical path**; on-chain notarization happens async.
3. Betting actions flow client → server over the socket; the server validates and advances the
   state machine (streets, turns, timeouts).
4. At showdown the server determines winners and calls **`financial-core`** to settle
   (`settlePots` / `transfer`) — the **ledger** moves, not the client.
5. Updated balances/state are pushed back to the clients.

## Test coverage

`game-server`: ~51 test files. `financial-core`: ~17 test files. ~482 tests combined, run with
Jest (`--runInBand`). Run `npm test` from root. (See [03-getting-started.md](03-getting-started.md).)

> **To confirm as you go (S1 in the week plan):** the exact client-facing HTTP routes and
> WebSocket message schema the gateway exposes. Read `scripts/app-server.ts` and the `ws`
> handlers; keep a running list — the frontend integration depends on it.
