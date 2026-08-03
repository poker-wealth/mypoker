# FairPlay — Build Plan to Aug 30 (FULL SCOPE · nothing deferred)

> **Target:** the ENTIRE project — all 16 milestones, all 9 games, all functionality — **live Aug 30, 2026**.
> **Mode:** maximum intensity, 7 days/week. Every remaining milestone is allocated below. Nothing left out.
> **Build target:** v5.9 base + M1 Remediation + v5.9.1 Merkle + v6.0 UltraFair.

---

## Done ✅ (foundation, ~147 tests green)
- **Financial Core** — accounts, double-entry ledger, `transfer()` + ClearingRules, settlement engine, 5-state withdrawals, TRC-20 deposits, HD derivation, 7 circuit breakers, `/api/v1` + real entrypoint.
- **Game-server framework** — EventBus, StateMachine, TurnManager, RoomManager, BaseGame, FinancialCoreClient.
- **Secure transport** — ECDH handshake, HMAC + sequence anti-replay, rate limit, 3-strikes.
- **Provably-fair v6.0** — server/client/future-block seeds, deterministic shuffle, Merkle aggregation, 6-step verifier.

---

## Schedule — Jun 23 → Aug 30

### W3 · Jun 23–29 — Texas Hold'em (complete)
- Hand evaluator (7-card best-5, all rankings, tie-breaks).
- Betting engine: blinds/straddle, streets (preflop→flop→turn→river→showdown), action validation, timeouts.
- Pot management: main + side pots, multi-all-in, dead money.
- Per-table 4-tier Jackpot accounts + 0.5% injection + triggers (Mini/Minor/Major/Grand thresholds).
- Insurance underwriting (5-step, Redis budget lock, no RiskFactor in UI, 2-all-in only).
- Wire provably-fair v6.0 (client seeds + future block) + 6-step verification into the live hand.
- Smoothness: optimistic-action handling, animation-window hooks, disconnect/reconnect (pause + 20s + caps).
- **Gate:** 9-player hand correct; jackpot from winner profit only; insurance shows/skip rules; full 6-step verify on a live hand.

### W4 · Jun 30–Jul 6 — 4 card games
- Baccarat (third-card rule, auto-settle, ×0.3 volume).
- Niu Niu (banker dual-lock concurrency, 牛 calc, payout table).
- Dou Di Zhu (bidding, play-legality: sequence/pair/triple/bomb/rocket).
- San Zhang (3-card comparison).
- Each: per-table Jackpot + v6.0 fairness + smoothness, on the State Machine pattern.
- **Gate:** all 4 settle correctly; Niu Niu bid race-safe; cross-game jackpot isolation; effective-volume coefficients.

### W5 · Jul 7–13 — last games + lobby
- Red Packet Minesweeper (server grid, hash committed pre-bet).
- Cowboy & Beauty (odds freeze T-5s).
- Lottery + Slots (isolated third-party adapters; FC unaffected on their failure).
- Multi-game lobby (per-game jackpot display, filters, winner ticker) + new-player flow.
- **Short Deck + Omaha** (owner-added, Jul 10; not in spec) — new deck + hand-ranking variants reusing existing betting/side-pots/settlement/shuffle. ~1-2 days, no money-code change.
- **Gate:** all 9 games playable; third-party failure isolated; install→first-hand <3 min.

> **Owner-added scope (Jul 10), not in the six specs:**
> - **Short Deck + Omaha** — Texas variants; slotted into W5 (above).
> - **Public fairness feed** — commit game *rules* (paytable/weights/rake) on-chain, versioned, per-round rule-version stamp; publish raw round dataset; players compute payout-rate themselves. Publish theoretical + lifetime-actual rate with sample size + expected range. Vendor games (Lottery/Slots) require the vendor to commit their config hash, else labelled "vendor-attested" not "provably fair". ~4 days, placed in W11 (chain work). **Prereq:** rule-commitment must land before W10 frontend (lobby RTP display + verification page read from it).

### W6 · Jul 14–20 — Jackpot engine + Insurance/Reinsurance + all CBs
- Grand Saturday window (3-condition gate), full history, weight/anti-arbitrage, on-chain jackpot commit, animation parallelism.
- Reinsurance pools (platform + league), insurance clawback cron.
- Wire CB1/CB2/CB3 to live insurance/jackpot data; WORM ledger export + daily Merkle balance-root.
- **Gate:** Grand 3-condition gate; CB1–CB7 fire ≤30s; reinsurance path; balance-root mismatch alarms.

> **⚡ AHEAD OF PLAN — actual state as of Jul 21.** The backend ran faster than this schedule: all 11 games, Financial Core, jackpots, insurance + reinsurance, anti-bot/reputation/VIP, agents, chat, spectator, league, and ops are DONE and tested (~482 tests). We entered the frontend early (W7). The week labels below (W7=VIP … W10=Frontend) are the original plan and are now superseded for the frontend phase by the order of work agreed with the owner:
>
> **FRONTEND ORDER OF WORK (owner-agreed, Jul 21):**
> 1. **Rest of W7** — remaining game table screens (all 11 games playable in the app). Placeholder branding. No owner input needed.
> 2. **W8 — AUTHENTICATION FIRST** (owner-directed: no login → no user → nothing to attach a profile/wallet to). Telegram identity → real player account. THEN, on top of real identity: real per-user **profile**, real per-user **wallet** (live money ledger, not the demo runtime), and **settings** saved to the account.
> 3. **Branding / UI restyle** — runs alongside from W8, applied the moment the owner supplies logo + brand colors + final name (or approves a proposed direction). **This is the only owner-blocking item** — flagged so it doesn't slip to launch week.
> 4. Then onboarding/first-open, VIP page, Agent Center, admin — through W10.
>
> Deployment (3-node + Solana mainnet, W11) and QA/launch (W12) unchanged.

### W7 · Jul 21–27 — VIP + Reputation + Anti-Bot + Peer Challenge
- VIP 5 tiers (effective volume, retention/grace, Pro Tracker, opponent tagging, V5 dynamic profiling + instant transfer, entry effects, Black Gold).
- Reputation (500→700, deductions, never blocks funds).
- Anti-Bot behavioral score; Peer Challenge (blowback + race fix); single-table + associated-group limits.
- **Gate:** VIP retention/caps; reputation never blocks withdrawal; blowback; single-table atomic.

### W8 · Jul 28–Aug 3 — Agents + Chat/Voice + Spectator
- 2-level agents, self-set sub-rates, per-hand commission (ledger-isolated from league rake), VIP-linkage cron, 4-tab dashboard, referral links.
- In-table chat (isolated namespace, XSS-safe) + Agora voice + spectator (5s delay, server-enforced).
- **Gate:** commission per hand <5s; league rake = zero agent entries; agent can't see balances; chat crash can't affect game.

### W9 · Aug 4–10 — League/Club + Ops/Admin + Risk AI
- League/club creation, private rooms (gateway-filtered), dual-wallet context isolation, autonomy + 7-day rake transition.
- Platform + league admin panels; withdrawal review queue; league top-up/cash-out.
- Collusion AI (human-confirm-only ban); anomaly cron (5-min); CB2/CB3 auto-actions.
- **Gate:** lobby never sees league tables; league wallet only in league context; AI never auto-bans; anomaly alerts ≤5 min.

### W10 · Aug 11–17 — Frontend (Telegram Mini App + iOS + Android)
- Optimistic-UI framework; Canvas table renderer + HTML/CSS UI; Lottie animations; MessagePack + delta updates.
- Screens: lobby, table (all 9 games), wallet/deposit/withdraw, VIP page, profile card, Agent Center, admin.
- Telegram Mini App build; React Native **Bare Workflow** iOS + Android packaging; device/root detection.
- **Gate:** full play loop on TG Mini App + iOS + Android; optimistic action <50ms on device.

### W11 · Aug 18–24 — Three-node + chain hardening
- Promote to three-node (Singapore primary / Tokyo / HK), `getBestNode`, table migration (<500ms), WAL live.
- Solana **mainnet** migration; blockchain 3-layer resilience (priority fee → Polygon → RFC-3161).
- **Gate:** routing by region; WAL consistent; migration <500ms; Solana on mainnet; latency SLAs met.

### W12 · Aug 25–30 — Full QA + audit + launch
- Ledger-integrity 100-hand (zero discrepancy); security pen test (6 paths); P99 latency; chaos (5 scenarios); 9-game regression on 3 platforms; hot-wallet funding; Go/No-Go → **launch Aug 30**.
- **Gate:** zero P0/P1; ledger zero discrepancy; P99 targets; chaos pass; Go/No-Go signed.

---

## Iron rules — never violated
1. No direct balance writes — money only via `transfer()` → ClearingRules → double-entry ledger (≤50ms txn).
2. No blockchain in the game critical path — deal at T+0ms; notarize async.
3. Reputation / collusion / anti-bot never block withdrawals.
4. RiskFactor never exposed to UI.
5. Anti-Bot score and Reputation independent; AI never auto-bans (human confirm).
6. Dual-system (Platform / League) isolation absolute.
7. All amounts integer / Decimal128 — no floats.
