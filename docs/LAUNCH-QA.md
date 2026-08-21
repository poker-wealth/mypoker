# Launch QA checklist

The gates that must be green before real money. Every item traces to a spec
line — this document does not invent criteria, it makes the spec's own
checkable and records what is already known about each.

**Source:** `docs_extracted/FairPlay_12Week_Milestone_EN.txt`, Week 12
("Full QA + Security Audit + Launch Prep"), plus the sections cited per item.
`docs_extracted/` is generated, not committed — if it is missing, run
`python extract_docx.py` against the `.docx` files in the repo root first.

> *"Every acceptance criterion from Weeks 1–11 must be green before W12 QA
> begins. If any is red: fix it, not defer it."* — W12 objective

## How to read this

Each item is either:

- **`[ ] AUTOMATED`** — a command in this repo answers it. Run it.
- **`[ ] MANUAL`** — needs a person, an environment, or a third party.
- **`[x] VERIFIED`** — checked during development, with what was checked.
- **`[!] OPEN`** — known not to pass today. These are the launch blockers.
- **`[ ] DECISION`** — behaviour is implemented and safe but stricter or looser
  than the spec's words; someone must choose it deliberately.

A box is only ticked by someone who ran the check and saw the result. An
inherited tick is worth nothing — the whole point of this document is that
somebody looked.

## Where it stands (18 Aug 2026)

| Gate | State |
|---|---|
| 1 · Ledger integrity | **automated** — checker built and verified against a settled hand + injected corruption; the 100-hand run on a live-like environment is still to do |
| 2 · Security | app-level controls verified; **MongoDB RBAC and the pen test are outstanding** |
| 3 · Latency | **not measured at all** — the largest untouched gate |
| 4 · Chaos | not started |
| 5 · Platforms | not started; the native app is in progress |
| 6 · Chain | rounds now notarize and commit; **contracts still on devnet** |
| 7 · Wallets | owner-side, not started |
| 8 · Go/No-Go | blocked on the above |

The honest summary: **what the application can enforce, it enforces and is
tested.** What remains is mostly not application code — load measurement, chaos
drills, cluster RBAC, a third-party pen test, mainnet migration, wallet funding
and store submissions. Those need an environment and people, not another commit.

---

## Gate 1 — Ledger integrity

> *"100-hand check → sum of all Ledger entries per account = current account
> balance. Zero discrepancy."*

- [ ] **AUTOMATED** — run the integrity check against the environment:

      ```bash
      cd financial-core
      MONGO_URI=<uri> MONGO_TLS=false npx ts-node scripts/ledger-integrity.ts
      ```

      (`MONGO_TLS=false` for a local mongod; drop it for Atlas.) Exits 0 on zero
      discrepancy, 1 on any, 2 if it could not run — a runbook or CI job can
      gate on it. Four invariants:
      **per-account** (`Σ credits − Σ debits` equals the three balances summed),
      **paired double-entry** (a transfer's idempotency key is a balanced pair),
      **pot conservation** (table settlements write single legs against a
      virtual `pot:<roundId>` — the pot must empty exactly: losses = wins +
      rake + jackpot), and **system-wide zero** (EXTERNAL is the only mint).
      Orphaned ledger rows naming a nonexistent account are reported too.
      Amounts go through integer micro-units, never a float, and anything the
      parser does not recognise (exponent notation, sub-micro precision) is
      itself reported rather than guessed at.
      An earlier version held settlement legs to the pair rule — it failed any
      healthy system that had settled one poker hand. A gate that fails healthy
      systems trains people to ignore it; that failure mode is now covered below.
- [ ] **MANUAL** — 100 hands played, then the check above run against that
      environment. Confirm ledger entries exist for jackpot inject, rake,
      payout, and agent commission where applicable. **Any gap blocks launch
      until root-caused.**
- [x] **VERIFIED (unit)** — settlement conserves money across 13 pinned
      scenarios including rounding boundaries:
      `cd game-server && npx jest test/games/settlement-regression`
      Σ(losers) = Σ(winners) + rake + Σ(jackpot), asserted per case.
- [x] **VERIFIED (unit)** — a replayed deposit writes no second ledger pair
      (`test/deposit`); an overdrawn jackpot pool cannot pay (`test/settlement`):
      `cd financial-core && npx jest test/deposit test/settlement`

## Gate 2 — Security

> *"Direct MongoDB balance update → RBAC rejects. Non-whitelist fund flow →
> IllegalFundFlowError."*

- [x] **VERIFIED** — non-whitelisted fund flow throws `IllegalFundFlowError`,
      writes a security-log entry, and alerts ops. Confirmed end to end against
      a real database: `TREASURY → INSURANCE` refused, logged, and shipped to a
      UDP collector.
- [ ] **MANUAL** — direct MongoDB balance `UPDATE` must be rejected by RBAC.
      **This is cluster configuration, not application code** — the app cannot
      enforce it. Needs MongoDB RBAC with no direct write grant on `accounts`
      or `ledger` (§11.2).
- [ ] **MANUAL** — withdrawal address change via a CS endpoint must 403.
- [x] **VERIFIED** — `leagueId` injection via request body is ignored; the JWT
      value is used. Covered by the data-scope tests.
- [ ] **MANUAL** — penetration test: ECDH session key reuse across rounds,
      WebSocket replay with a stale sequence number, 4 verification failures →
      disconnect + 30-minute fingerprint ban, NoSQL injection on every public
      endpoint.
- [x] **VERIFIED** — the admin API answers 404 (not 403) to non-ops, so it does
      not confirm its own existence to a stolen player token. **Now on `main`**
      (PR #17): `cd game-server && npx jest test/gateway/admin-routes`.
      Re-confirmed against a live stack: no token → 401, player token → 404,
      forged signature → 401, ops token → 200.

## Gate 3 — Latency

> *"P99 (100 concurrent players, 50 tables): card deal <200ms, action <50ms,
> insurance <30ms, post-Jackpot gap <200ms. ALL four pass."*

An earlier revision of this file said "not measured at all". That was wrong,
and it understated what exists. The engine budgets **are** measured and pinned;
what is missing is the *load* and the *transport*. Precisely:

- [x] **AUTOMATED** — deal and action P99, in-memory, no I/O:
      `cd game-server && npm test -- test/perf/game-latency.test.ts`.
      Passing. Its real value is regression protection — if a change puts a DB
      read or a chain call on the deal or action path, this fails loudly
      instead of the table quietly getting slow.
- [ ] **insurance P99 <30ms — NOT verified.** That test asserts the **median**,
      deliberately: on a shared dev machine the p99 is dominated by unrelated
      process scheduling (40–80ms run-to-run for the same code). The reasoning
      is sound and documented in the test, but it means the spec's p99 budget
      is still owed a run on dedicated hardware.
- [ ] **post-Jackpot gap <200ms — not measured, and structurally at risk.**
      No test covers it, and the code path suggests it is the metric most
      likely to fail. In `poker-room.ts` the room's `settleTableHand` awaits
      `evaluateJackpots()`, which on a hit awaits `fc.jackpotPayout()` — a
      financial-core round-trip and ledger write — *before* the win is
      announced and therefore inside the gap the 200ms budget measures.

      That ordering is deliberate and correct: announcing first would show an
      animation for a win the ledger might refuse (see the comment at
      `poker-room.ts:1037`). But the spec's own design (12-week plan, "Jackpot
      animation parallel optimization") assumes the opposite shape — the
      animation starts, and the next hand is prepared *during* its 3–10s
      window, so the gap is near zero. Nothing implements that overlap.

      So the budget currently applies to a synchronous ledger round-trip.
      **Measure before redesigning** — if the round-trip is comfortably inside
      200ms this is a non-issue; if it is not, the fix is a money-correctness
      trade (show an unconfirmed win, or hold the table) and is Victor's call,
      not a client-side tweak.
- [ ] **MANUAL** — 100 concurrent WebSocket connections, 50 active tables.
      Nothing measures the system *through the transport under concurrency*,
      which is what the gate actually asks for. The in-memory numbers say the
      algorithms are fast; they say nothing about 100 sockets contending.

**A P99 failure blocks launch and cannot be waived**, so the two unmeasured
items above are real launch risk, not paperwork. The load harness needs an
environment that is not a developer laptop: numbers taken here would be
dominated by local resource contention and would not transfer.

## Gate 4 — Chaos

> *"MongoDB primary fail + WAL + recovery → Ledger consistent, zero duplicates.
> drand fail → KMS within 5s, game continues."*

Isolated environment, synthetic data — **never production data** (W12, Day 58).

- [ ] **MANUAL** — MongoDB primary fails → WAL activates → primary returns →
      replay → ledger consistent, zero duplicates.
- [ ] **MANUAL** — drand all nodes fail → KMS fallback within 5s, game continues.
- [ ] **MANUAL** — Redis primary fails → Redlock releases within TTL.
- [ ] **MANUAL** — certificate expiry → alert fires, connection rejected.

## Gate 5 — Platforms

> *"Zero P0 bugs, zero P1 bugs (iOS / Android / TG Mini App)."*

- [ ] **MANUAL** — three-platform regression: every game, full hand, withdrawal,
      deposit, VIP progress, agent dashboard, chat.
- [ ] **MANUAL** — 9-game regression with edge cases documented PASS/FAIL:
      jackpot below threshold, insurance with 3+ all-in players, Grand window,
      disconnect mid-hand, associated-account group block.
- [ ] **MANUAL** — app size under 100MB; store listings in all supported
      languages.

## Gate 6 — Chain

> *"Solana contracts: migrated from devnet to mainnet. commitRound live on
> mainnet."*

- [x] **VERIFIED** — real rounds now reach the chain. `MerkleRoundNotary`
      persists every settled round and queues its hash into `MerkleAggregator`,
      the gateway mounts live tables with `notarize: true`, and the spec's
      30-second flush is configured (`flushIntervalMs: 30_000`) so a quiet table
      still commits a partial batch. This was the V1 audit's "aggregator is
      called by no production code" finding; it is closed.
      Still worth a live check before launch: play a hand, then confirm its
      round doc carries a `merkleRoot` and a non-null `chainTx`.
- [!] **OPEN** — contracts are on devnet, not mainnet. `SolanaChainClient`
      exists and is tested; L2 (Polygon) and L3 (RFC 3161) are unconfigured
      declining layers, so a Solana outage degrades to a local timestamp.

## Gate 7 — Wallets

- [ ] **MANUAL** — hot wallet funded, balance within the $50K cap.
- [ ] **MANUAL** — warm wallet funded.
- [ ] **MANUAL** — cold wallet confirmed by multi-sig holders.

## Gate 8 — Go/No-Go

> *"All team leads sign off. No outstanding P0 or P1. Launch approved."*

- [ ] Engineering: infrastructure stable, monitoring active, TG Bot alerts
      configured.
- [ ] Operations: withdrawal queue staffed, league admin contacts onboarded.
- [ ] Security: whitepaper published, rules document distributed.
- [ ] All of Gates 1–7 green.

---

# Known-open items

Things found during development that the spec cannot know about. These are not
optional polish — each one is either a money risk or a claim the product makes
that is not currently true.

## Blocks real money

- [x] **VERIFIED** — insurance quotes against the **live** pool, not the old
      `INSURANCE_RESERVE_PLACEHOLDER`. Traced end to end: the room reads
      `/internal/insurance/reserve` on a 15s refresh, distrusts anything older
      than 60s, and every failure mode — no reserve read yet, a stale one, an
      unreachable financial-core, a client that cannot report, a pool of zero —
      lands on **no offer** rather than a guess. §4's auto-disable is the same
      code path: `reserve_below_threshold`.
      Verified by **reading the path**, not by a test — the underwriter's rules
      are well covered (`test/games/texas/underwriting.test.ts`) but the room's
      refresh, the 60s trust window, and the degrade-to-no-offer behaviour have
      **no test at all**. Worth one before insurance handles real money: the
      failure it would catch is silent, and it quotes against stale numbers.
- [x] **VERIFIED** — a player can actually withdraw. §3.6 requires a
      pre-registered address; financial-core enforced it while nothing could
      **set** one, so every withdrawal returned `403 no withdrawal address is
      set`. The gateway now proxies it and the wallet has the UI.
- [x] **VERIFIED** — the **>₮10,000 two-person rule** genuinely holds, attacked
      rather than read: ₮10,000.00 releases on one approval and ₮10,000.01 does
      not (strictly `>`, per spec); the same approver signing three times stays
      at 1 of 2; only a second distinct token releases it; and re-posting with
      `{"approverId":"ops-bob"}` in the body is ignored because the gateway
      takes the signer from the verified token. Reject releases the clearing
      hold exactly, with the total conserved.
- [ ] **DECISION** — the 48h withdrawal-address cooldown fires on a
      **first** registration, not only a change. The spec says "address
      **modification**: 48h cooldown", so this is stricter than written: every
      new player's first withdrawal waits 48 hours. Defensible as security (an
      account takeover cannot set an address and drain immediately), but it is a
      product decision that should be made deliberately, not inherited.
- [!] **Rotate the credentials that passed through chat**: the Atlas password,
      the Telegram bot token, and the `wang@mypoker777.com` mailbox password.
- [ ] **SPF, DKIM and DMARC** for `mypoker777.com`. A new domain sending
      transactional mail lands in spam without them, and a deposit receipt in
      spam becomes a support ticket. Check "show original" on a received
      message — it prints pass/fail for all three.

## Claims the product makes

- [x] **VERIFIED** — **"Fair. On-Chain. Always."** now holds for a hand actually
      played, not only one pasted into the verifier: live tables notarize every
      settled round and the aggregator commits batch roots on-chain (Gate 6).
      The published payout rates are anchored too — the rules that produced them
      are hashed and committed on-chain per version, and every round records the
      version it ran under (`game-server/src/fairness/rule-version.ts` — on the
      rule-version-stamp branch; this claim holds once that PR merges).
      Remaining honesty caveat: a round's own leaf hash does not commit to the
      rule version — the version is stored beside the round, because folding it
      into `computeRoundHash` would stop every already-notarized round from
      verifying. Closing that is a v6.0 verifier-contract change.
- [ ] **V3's "Pro Tracker HUD (VPIP, PFR)"** is marked *coming soon* rather than
      dropped, because those figures are not derivable from the ledger. Either
      build the data or remove the promise before a V3 player pays for it.

## Deployment

- [ ] **Gateway deployed**, `VITE_API_URL` set, `CORS_ORIGINS` carrying both
      apex and www **with the scheme** (exact-match allowlist, no wildcard).
      Until then every player-scoped screen shows a retry card.
- [ ] **HTTPS enforced.** Telegram refuses to load a Mini App over plain http.
- [ ] **BotFather Mini App URL** and **Google OAuth origins** updated to the
      real domain, or sign-in fails with `redirect_uri_mismatch`.

## Notification delivery

- [x] **VERIFIED** — a credited deposit produces a real email, received in an
      external inbox. Telegram routing verified: TG players get TG, web
      sign-ups get email, neither gets both.
- [ ] **MANUAL** — ops circuit-breaker alerts have never been seen arriving in
      a real chat. Needs `TELEGRAM_BOT_TOKEN` and `OPS_TELEGRAM_CHAT_ID`, then
      trip CB6 and watch.
- [ ] **MANUAL** — `SYSLOG_HOST` pointed at the real collector, and one event
      confirmed arriving there.

## Table flow

- [ ] **§6.4 disconnect rules** are partially implemented: the 20-second grace
      is correct, but the timer-pause, the 10-second check-round auto-check, the
      60s per-hand cap and the per-hour cap are not built. Note the per-hour cap
      is **VIP-tiered** (V1–V3 = 3, V4–V5 = 5) per the 12-week plan Day 14,
      where §6.4 states a flat 3. Ownership is unstated in the docs.

---

## Running the automated checks

```bash
# financial-core + game-server (root verify does NOT touch the frontend)
npm run verify                                   # typecheck + lint + tests
# the frontend, separately
cd frontend && npx tsc -b && npx eslint src && npx vite build

# The money paths specifically
cd financial-core && npx jest test/settlement test/wallet test/league
cd game-server    && npx jest test/games/settlement-regression

# Gate 1, against a real database (exit 1 = discrepancy)
cd financial-core && MONGO_URI=<uri> npx ts-node scripts/ledger-integrity.ts

# The fairness stamp (rule-version-stamp branch; on main these suites do not
# exist yet): rules hash deterministically, round hash stays byte-identical
cd game-server    && npx jest test/fairness/rule-version test/fairness/rule-stamp

# The guards
cd game-server    && npx jest test/gateway test/lobby/league-isolation
```

**Baseline (verified 18 Aug 2026, on `main`):** financial-core **345/345**,
game-server **853/853** across 103 suites. Both packages typecheck clean; the
frontend typechecks and builds.

The four `app.test.ts` failures this section used to warn about are **fixed** —
they were placeholder `'TXaddr'` addresses the real TRON validator rejected
before the flow under test ran.

Two things a runner should still expect, so neither is mistaken for a regression:

- **16 eslint `any` errors** in `frontend/src/components/games/` — pre-existing,
  not introduced by any checklist work.
- Run financial-core with **`-w 1`** if suites fail in bulk. The in-memory Mongo
  instances contend on a loaded machine, and a contended run fails whole suites
  at setup, which looks alarming and means nothing. A crashed run also leaves
  `mongo-mem-*` directories in the temp dir; a later start can fail with
  `fassert()` until they are cleared.
