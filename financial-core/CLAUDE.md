# financial-core — the money service

Express + Mongoose. Owns accounts, the ledger, settlement, deposits, withdrawals, leagues, jackpot pools. See the root `CLAUDE.md` for the iron rules.

## Money

- **Everything through `transfer()`** (`src/wallet/transfer.ts`). It runs the clearing whitelist, the idempotency key, and the overdraft guard in one transaction. A new money-moving primitive is a design error, not a shortcut.
- **`Money`** (`src/domain/money.ts`) is integer micro-units under the hood. `Money.fromDecimalString` in, `toDecimal128()` to store, `toString()` out. Never `Number()` an amount.
- **Idempotency key on everything retryable.** A replayed deposit, settlement or grant must be a no-op, not a second movement.
- **Clearing whitelist** (`src/clearing/clearing-rules.ts`) is the CB6 control — a non-whitelisted flow throws `IllegalFundFlowError`, writes a security log and alerts ops. Adding a pair to that list is a money decision.

## Facts, not rules

This service returns figures. It does **not** decide reputation bands, VIP tiers, alert severity, or whether a league's rake is legal — those live in game-server. Duplicating a rule here is how the two halves drift.

## Account scoping — read this before touching balances

`getOrCreatePlayerAccount(playerId, scope)` defaults to `PLATFORM`. A **league** wallet is the same player under `scope = leagueId`, and the two are deliberately separate (the spec's dual-wallet isolation; league money in a platform context is called a "critical isolation failure").

Consequences that have bitten before:
- Deposits credit the **platform** wallet. A league buy-in resolves the **league** wallet. Funding one does not fund the other.
- Withdrawals resolve the **platform** wallet only — league chips cannot be withdrawn. That containment is why a league grant needs league authority rather than platform ops.

## Ledger shapes (they are not uniform)

- `transfer()` writes a **balanced pair** sharing one idempotency key.
- `settleTableHand` writes **single legs** against a virtual `pot:<roundId>` counterparty that has no account. Its invariant is per-pot conservation: losses in = wins + rake + jackpot out. Holding these to the pair rule false-fails every healthy system that has played a hand — that bug shipped once.

`scripts/ledger-integrity.ts` checks both shapes plus system-wide zero. Exit 0 clean / 1 discrepancy / 2 could-not-run.

## Errors

Register every new `*Error` class in `src/http/middleware.ts`. An unmapped one falls through to the catch-all as `500 internal_error` **and pages ops** — a mistyped id firing a Telegram alert is how a pager stops being read.

## Tests

`npm test` (pins `--runInBand` — see root notes). `scripts/` is inside the typecheck config, so `npm run typecheck` covers it.
