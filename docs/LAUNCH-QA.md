# Launch QA checklist

The gates that must be green before real money. Every item traces to a spec
line — this document does not invent criteria, it makes the spec's own
checkable and records what is already known about each.

**Source:** `docs_extracted/FairPlay_12Week_Milestone_EN.txt`, Week 12
("Full QA + Security Audit + Launch Prep"), plus the sections cited per item.

> *"Every acceptance criterion from Weeks 1–11 must be green before W12 QA
> begins. If any is red: fix it, not defer it."* — W12 objective

## How to read this

Each item is either:

- **`[ ] AUTOMATED`** — a command in this repo answers it. Run it.
- **`[ ] MANUAL`** — needs a person, an environment, or a third party.
- **`[x] VERIFIED`** — checked during development, with what was checked.
- **`[!] OPEN`** — known not to pass today. These are the launch blockers.

A box is only ticked by someone who ran the check and saw the result. An
inherited tick is worth nothing — the whole point of this document is that
somebody looked.

---

## Gate 1 — Ledger integrity

> *"100-hand check → sum of all Ledger entries per account = current account
> balance. Zero discrepancy."*

- [ ] **MANUAL** — 100-hand spot check against a live-like environment. Every
      hand: ledger entries exist for jackpot inject, rake, payout, and agent
      commission where applicable.
- [ ] **MANUAL** — For every account: `Σ(ledger entries) === current balance`.
      Zero discrepancy allowed. **Any gap blocks launch until root-caused.**
- [x] **VERIFIED (unit)** — settlement conserves money across 13 pinned
      scenarios including rounding boundaries:
      `cd game-server && npx jest test/games/settlement-regression`
      Σ(losers) = Σ(winners) + rake + Σ(jackpot), asserted per case.
- [x] **VERIFIED (unit)** — a replayed deposit writes no second ledger pair;
      an overdrawn jackpot pool cannot pay:
      `cd financial-core && npx jest test/settlement`

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
      not confirm its own existence to a stolen player token. Covered on the
      **`feat/admin-ui--samuel`** branch, which is not merged — the tests do not
      exist on `main`, so re-run this gate after that PR lands.

## Gate 3 — Latency

> *"P99 (100 concurrent players, 50 tables): card deal <200ms, action <50ms,
> insurance <30ms, post-Jackpot gap <200ms. ALL four pass."*

- [ ] **MANUAL** — all four measured under production-shaped load and
      documented. **Not yet measured at all.** A P99 failure blocks launch;
      it cannot be waived.
- [ ] **MANUAL** — 100 concurrent WebSocket connections, 50 active tables.

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

- [!] **OPEN** — the Merkle aggregator is **called by no production code**, so
      real rounds are verifiable locally (step 6a) and anchored nowhere (6b).
      `MerkleAggregator` exists and is unit-tested; nothing feeds it. Also
      missing: the spec's 30-second flush ("every 100 rounds **or 30s**"), so a
      quiet table would never commit a batch. **Unowned** — appears in no P3
      queue item, and `docs/handoff/05-where-we-stopped.md` marks
      "Provably-fair v6.0 (commit-reveal + Merkle)" ✅, which covers the
      components rather than a working path.
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
- [!] **Rotate the credentials that passed through chat**: the Atlas password,
      the Telegram bot token, and the `wang@mypoker777.com` mailbox password.
- [ ] **SPF, DKIM and DMARC** for `mypoker777.com`. A new domain sending
      transactional mail lands in spam without them, and a deposit receipt in
      spam becomes a support ticket. Check "show original" on a received
      message — it prints pass/fail for all three.

## Claims the product makes

- [!] **"Fair. On-Chain. Always."** holds for a hand pasted into the verifier,
      not for a hand actually played — see Gate 6.
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
# Everything, all three packages
npm run verify                                   # typecheck + lint + tests

# The money paths specifically
cd financial-core && npx jest test/settlement test/wallet test/league
cd game-server    && npx jest test/games/settlement-regression

# The guards
cd game-server    && npx jest test/gateway test/lobby/league-isolation
```

**Known:** 4 tests fail in `financial-core/test/http/app.test.ts` on `main`
(stale `'TXaddr'` fixtures and a settlement 409). Two are fixed by the profile
branch. Fix them before using this checklist, or a real regression will hide
among them.
