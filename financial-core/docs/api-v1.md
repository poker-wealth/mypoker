# FairPlay Financial Core — API Reference (`/api/v1`)

**Status:** Released for integration · **Version:** v1 · **Audience:** Frontend + Game Server teams

The Financial Core owns every cent. **No service writes balances directly** — all money moves
through this API. This document is the integration contract; the machine-readable OpenAPI spec is
served live at **`GET /api/v1/openapi.json`**.

---

## Base & conventions

- **Base URL:** `http://<fc-host>:4001/api/v1` (dev). All paths below are relative to it.
- **Money is always a decimal string**, never a JSON number — e.g. `"12.500000"` (6 dp, USDT
  precision). Send and expect strings. This avoids floating-point error.
- **Content-Type:** `application/json`. Max body 64 KB.
- **Idempotency:** deposits use the on-chain `txHash`; settlements use `roundId`. Replays are safe
  no-ops.

## Authentication

| Caller | Mechanism | Header |
|--------|-----------|--------|
| Player (frontend) | JWT (HS256), issued by the auth service | `Authorization: Bearer <jwt>` |
| Internal service (game server, ops) | Shared secret | `x-internal-secret: <secret>` |

The JWT carries the caller's scope (`playerId`, optional `leagueId`, `role`). **Scope is read from
the token only — never from the request body.** A caller cannot widen their data access by passing
a different id in the payload.

---

## Player endpoints (JWT)

### `GET /me/balance`
Returns the authenticated player's wallet balances.

**200**
```json
{ "playerId": "p-123", "available": "500.000000", "locked": "0.000000", "clearing": "0.000000" }
```
- `available` — spendable. `locked` — escrowed at a table (buy-in). `clearing` — withdrawal in flight.

### `POST /me/withdrawals`
Request a withdrawal. Balance is **not** deducted yet (risk review happens first).

**Body**
```json
{ "amount": "200.000000", "address": "TXxxx…" }
```
**201** → `{ "withdrawalId": "uuid", "state": "REQUESTED" }`
**409** if `amount` exceeds available balance.

---

## Internal endpoints (`x-internal-secret`)

### `POST /internal/deposits`
Credit a confirmed on-chain deposit. Gated by the TRC-20 rules: **official contract only**, and
**≥20 confirmations** (mempool/unconfirmed is never credited).

**Body**
```json
{ "playerId": "p-123", "amount": "100.000000", "txHash": "0x…",
  "contractAddress": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "confirmations": 20 }
```
**200** → `{ "credited": true }` or `{ "credited": false, "reason": "wrong_contract" | "unconfirmed" | "already_credited" }`

### `POST /internal/settlements`
Settle a finished hand (jackpot inject → rake), atomic, idempotent on `roundId`.

**Body**
```json
{ "roundId": "r-1", "tableType": "PLATFORM", "leagueId": "lg-1 (league tables only)",
  "winnerAccountId": "acc-uuid", "winnerProfit": "1000.000000", "rake": "50.000000",
  "jackpotAccounts": { "mini": "acc", "minor": "acc", "major": "acc", "grand": "acc" } }
```
**200** → settlement receipt:
```json
{ "roundId": "r-1", "sequence": ["jackpot_inject","rake","payout"],
  "amounts": { "jackpot": "5.000000", "rake": "50.000000", "payout": "1000.000000" },
  "accounts": { "jackpotMini": "…", "rakeDest": "…", "winner": "…" },
  "hash": "<sha256>" }
```

### `POST /internal/buy-ins` · `POST /internal/releases`
Lock a buy-in (`available → locked`) / release on leaving a table (`locked → available`).

**Body** → `{ "playerAccountId": "acc-uuid", "amount": "500.000000" }` · **200** → `{ "ok": true }`

### Withdrawal lifecycle (ops/internal)
- `POST /internal/withdrawals/:id/approve` — hold funds `available → clearing`. → `{ "state": "APPROVED" }`
- `POST /internal/withdrawals/:id/broadcast` — body `{ "txHash": "…" }`. → `{ "state": "BROADCASTING" }`
- `POST /internal/withdrawals/:id/confirm` — funds leave platform. → `{ "state": "CONFIRMED" }`

---

## Errors

Uniform shape: `{ "error": "<message>" }` (validation also returns `details`).

| Status | When |
|--------|------|
| 400 | Validation failed / malformed amount |
| 401 | Missing/invalid JWT or internal secret |
| 403 | Illegal fund flow (non-whitelisted clearing path — **CB6**) |
| 404 | Account or withdrawal not found |
| 409 | Insufficient balance / invalid withdrawal-state transition |
| 500 | Unexpected (ops alerted) |

## Guarantees the API enforces

- Every fund movement passes the **ClearingRules whitelist** (CB6) — non-whitelisted flows are
  rejected, logged, and alerted.
- **Double-entry** ledger: Σ(debits) = Σ(credits) at all times.
- **Idempotent** deposits (txHash) and settlements (roundId).
- **Locked funds are not withdrawable**; withdrawals only ever touch `available`.

## Health

`GET /health` (open) → `{ "status": "ok", "service": "financial-core" }`
