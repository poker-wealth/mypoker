# FairPlay — Financial Core

The **true core** of FairPlay. All games are plugins; this service owns every cent.

> **Iron rule:** no module may write a balance directly. All fund movement goes through
> `transfer()` → `ClearingRules` whitelist → double-entry ledger, inside one MongoDB
> transaction (≤50ms). Direct `UPDATE balance` is forbidden everywhere.

Build target reconciles four specs: **v5.9 base + M1 Remediation (3-balance wallet, double-entry
ledger) + v5.9.1 Merkle (on-chain) + v6.0 UltraFair (randomness)**. See `../PROJECT_PLAN.md`.

## Status

**M0 — scaffold.** Toolchain, strict TypeScript, and the `Money` primitive are in place.
The accounts/ledger schema, `transfer()`, ClearingRules, Settlement Engine, withdrawal state
machine, and the seven circuit breakers land in **M1**.

## Money

Amounts are **never** JS floats. `Money` is a `bigint` of micro-units (6 dp, matching USDT-TRC20),
persisted as `Decimal128`. See `src/domain/money.ts`.

## Develop

```bash
npm install
npm run typecheck   # strict tsc, no emit
npm test            # jest (ts-jest)
npm run lint
npm run build       # -> dist/
```

MongoDB must be a **replica set** (transactions require it). Tests use `mongodb-memory-server`
(single-node replica set, no install). For a persistent local stack use the root `docker-compose.yml`.

## Try it without a database (zero install)

```bash
npm run smoke        # drives the whole money lifecycle end-to-end, prints ✅/❌
npm run dev:memory   # live server on an in-memory DB; prints copy-paste API commands
npm run bench        # settlement latency (p50/p95/p99/max)
```

These boot an in-memory replica set and use built-in dev secrets — no `.env` needed. Great for
verifying behaviour; data is discarded on exit.

## Run as a real service (persistent DB)

The production entrypoint (`src/index.ts`) loads `.env`, connects to a **real** MongoDB, starts the
server, and shuts down cleanly.

```bash
cp .env.example .env          # then edit .env:
#   MONGO_URI = a replica-set connection string (MongoDB Atlas free tier, or a local RS)
#   INTERNAL_API_SECRET, JWT_SECRET = real secrets (≥8 chars)
npm run dev                   # boots against your configured DB; data persists across restarts
```

`.env` is git-ignored — secrets never get committed. The service refuses to boot if `MONGO_URI` or
the secrets are missing (fail-fast, not wide-open). The boot path is covered by
`test/server-boot.test.ts`.
