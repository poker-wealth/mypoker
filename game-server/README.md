# FairPlay — Game Server

Hosts the games (Texas Hold'em first, then 8 more), the Unified State Machine, real-time
WebSocket transport, provably-fair (commit-reveal + Merkle + v6.0 UltraFair randomness), and
the smoothness layer.

> The game server **never** writes balances. It calls the Financial Core API (`/api/v1/`) for
> every fund movement. Direct DB writes to money are forbidden.

## Status

**W2 — Unified State Machine framework in place** (`src/core/`):

- `EventBus` — typed pub/sub decoupling game logic from transport.
- `StateMachine` — generic FSM; the only way game phase changes (iron rule #2).
- `TurnManager` — seat order, turns, folds, betting-round completion.
- `RoomManager` — table lifecycle + seating + one-table-per-player.
- `FinancialCoreClient` — the only path to money (iron rule #3); HTTP impl calls FC `/api/v1`.
- `BaseGame` — the contract every game implements; embeds the three iron rules.

Next: WebSocket transport, then the first game (Texas Hold'em).

```bash
npm install
npm test        # framework unit tests
npm run lint
npm run build
```
