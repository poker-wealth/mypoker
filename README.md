# FairPlay

A real-time **financial clearing platform with game shells** — Web2.0 speed, Web3 verifiability.
The Financial Core is the product; the 9 games are plugins. Centralized accounts, USDT/TRC-20
money rails, Solana as a notary (never in the game critical path).

## Repository layout

| Path | What it is | First active milestone |
|------|------------|------------------------|
| [`financial-core/`](financial-core/) | The true core. Wallets, double-entry ledger, `transfer()` + ClearingRules, settlement, withdrawals, circuit breakers. **Owns every cent.** | **M1** |
| [`game-server/`](game-server/) | Games, Unified State Machine, WebSocket transport, provably-fair, smoothness. Calls FC API for all money. | **M2 / M3** |
| [`PROJECT_PLAN.md`](PROJECT_PLAN.md) | The day-by-day build plan: 16 milestones, gates, iron rules. | — |
| `*.docx` | Source specs (v5.9 base + M1 Remediation + v5.9.1 Merkle + v6.0 UltraFair). | — |

## Build target

Reconciles four specs — build the **latest** of each concern, never the base's older version:

**v5.9 base** (whole product) **+ M1 Remediation** (3-balance wallet, double-entry ledger)
**+ v5.9.1 Merkle** (batch on-chain commit) **+ v6.0 UltraFair** (client-seed + future-block randomness).

## Iron rules (never violated)

1. No direct balance writes — money moves only through `transfer()` → ClearingRules → double-entry ledger (≤50ms txn).
2. No blockchain in the game critical path — deal at T+0ms, notarize async.
3. Reputation / collusion / anti-bot never block withdrawals.
4. RiskFactor never exposed to UI.
5. Dual-system (Platform / League) isolation is absolute.
6. All amounts integer / Decimal128 — no floats.

See [`PROJECT_PLAN.md`](PROJECT_PLAN.md) for the full list and the per-milestone gates.

## Getting started

```bash
cd financial-core
npm install
npm test
```

MongoDB must run as a **replica set** (transactions). Tests use `mongodb-memory-server` (no install);
for a persistent stack, `docker compose up -d` from the repo root.
