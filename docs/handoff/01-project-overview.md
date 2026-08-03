# 01 · Project Overview

## What we're building

**MYPOKER** — a provably-fair, multi-game online poker & casino platform.

- **Delivery:** primarily a **Telegram Mini App** (runs inside Telegram), plus a normal web
  build. Later, native iOS/Android wrappers.
- **Money:** real crypto (USDT on TRON/TRC-20 for deposits; Solana for the on-chain fairness
  and jackpot commitments). All balances are integer/Decimal128 — **never floats**.
- **The hook — "Fair. On-Chain. Always.":** every deal is *provably fair*. The server commits
  to a shuffle before the hand, reveals seeds after, and anyone can verify the result on-chain.
  This is the product's core differentiator.
- **Brand:** the product name is **MYPOKER**. Palette is violet `#BB5CF6`, indigo `#6366F1`,
  neon-cyan `#00D4FF` on near-black `#0D0D1A`. (The repo/package is still named `fairplay`/
  `poker` for historical reasons — don't be confused, it's the same project.)

## The games (all 11 exist in the backend)

Texas Hold'em, Short Deck, Omaha, Baccarat, Niu Niu, Dou Di Zhu, San Zhang, Red Packet
(Minesweeper), Cowboy & Beauty, Lottery, Slots. See [02-architecture.md](02-architecture.md)
for where each lives.

## The specs

The product is defined by a stack of `.docx` documents in the repo root (tracked in git):

- `FairPlay_v5.9…` — the base spec.
- `FairPlay_v5.9.1_CommitReveal_Merkle_EN.docx` — the Merkle commit-reveal fairness upgrade.
- `FairPlay_v6.0_UltraFair_EN.docx` — the latest fairness model (server/client/future-block
  seeds, deterministic shuffle, Merkle aggregation, 6-step verifier).
- `FairPlay_16Milestone_Technical_Plan_EN…` — the milestone breakdown.

There is also a working build plan at repo root: **[`PROJECT_PLAN.md`](../../PROJECT_PLAN.md)**
— the week-by-week schedule to the Aug 30 2026 launch, with an honest "actual state" note.
Read that after this doc; it is the source of truth for the overall timeline.

> You don't need to read the `.docx` files to do this week's work. They're reference for deep
> questions about rules (paytables, fairness math, jackpot thresholds). Ask Victor first — he
> knows them.

## Iron rules — never violate these

These come straight from the spec and are **non-negotiable**. A PR that breaks one will be
rejected regardless of how nice the code is.

1. **No direct balance writes.** Money moves *only* via `financial-core`'s `transfer()` →
   ClearingRules → double-entry ledger. Never write a balance field directly.
2. **No blockchain in the game's critical path.** Deal the cards at T+0ms; notarize to chain
   asynchronously. A slow chain must never slow or block a hand.
3. **Reputation / collusion / anti-bot never block withdrawals.** A player can always get
   their money out.
4. **RiskFactor is never shown in the UI.** It's an internal signal only.
5. **Anti-bot score and reputation are independent, and AI never auto-bans** — a human must
   confirm any ban.
6. **Platform and League systems are absolutely isolated.** League tables/wallets never leak
   into the platform lobby and vice-versa.
7. **All amounts are integer / Decimal128 — no floats, ever.**
8. **The platform is never the banker.** For banker-style games a *player* banks and the
   platform only takes rake; settlement always flows through the player-funded pooled path.

## Status in one paragraph

The **backend is done and green** (~482 tests) — all games, the money core, jackpots,
insurance/reinsurance, anti-bot, VIP, agents, chat, spectator, league, ops. It is **not yet
deployed** and **not yet connected to a real frontend**. The **frontend** is a freshly built,
fully branded React app with the app shell, the four main tabs, and one playable poker table
running on a *client-side demo engine* (play money, no server). Bridging those two — auth,
real wallet, live game feed, deployment — is the current phase and the subject of this week's
plan ([06-week-plan.md](06-week-plan.md)).
