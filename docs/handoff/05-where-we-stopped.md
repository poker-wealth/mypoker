# 05 · Where We Stopped

This is the honest, precise state of the project at handoff. Read it carefully — it tells you
what is real, what is a placeholder, and what does not exist yet.

## Backend — DONE and tested, NOT deployed

Both `game-server/` and `financial-core/` are feature-complete for the current milestone and
pass their test suites (~482 tests combined). See [02-architecture.md](02-architecture.md) for
the module map and [03-getting-started.md](03-getting-started.md) to run them.

- ✅ All 11 games implemented with rules + settlement.
- ✅ Financial Core: double-entry ledger, `transfer()`/ClearingRules, deposits, withdrawals,
  settlement, circuit breakers.
- ✅ Jackpots, insurance/reinsurance, anti-bot/reputation/VIP, agents, chat, spectator, league,
  ops — per `PROJECT_PLAN.md`.
- ✅ Provably-fair v6.0 (commit-reveal + Merkle) and a runnable HTTP + WebSocket game-server.
- ❌ **Not deployed** anywhere. Runs locally only.
- ❌ **Not connected to the frontend.** No client currently talks to the real WS/HTTP API.
- ⚠️ A few backend loose ends are noted as not-yet-built in the plan: Agora **voice chat**, the
  live **anomaly-detection cron**, and the **club-under-league** system. Confirm scope with
  Victor before touching these; they are **not** in this week's plan.

## Frontend — early, branded shell + one demo table

Built fresh this phase (see [04-frontend-guide.md](04-frontend-guide.md)). What exists:

| Area | State |
|------|-------|
| App shell (header, bottom nav, routing, page transitions) | ✅ Real |
| MYPOKER branding (colors, logo, theme toggle, dark/light) | ✅ Real |
| Component kit (Button, Card, Badge, Input, Sheet, Segmented, ListRow) | ✅ Real |
| **Lobby** page (jackpot hero, online count, game tiles) | ⚠️ UI only — numbers are hardcoded in `lib/games.ts` |
| **Games** page (search, category filter, grid, coming-soon) | ⚠️ UI only — same static catalog |
| **Wallet** page (balance, deposit/withdraw, top-up, referral, activity) | ⚠️ UI only — no real balance, buttons do nothing |
| **Profile** page (identity, sign-in CTA, stats, menu) | ⚠️ UI only — "Guest Player", stats are zeros |
| **Poker table** (`/table/:id`) | ⚠️ **Demo only** — plays real hands but on the client-side play-money engine, no server |
| Telegram integration (`lib/telegram.ts`) | ✅ Wrapper exists (haptics, initData, back button); **not used for auth yet** |

### What "demo only" means for the table
The table at `/table/:id` deals cards, runs betting, shows a winner, and starts the next hand —
but it's all **local play money** via `hooks/useDemoHand.ts` + `lib/pokerEngine.ts`. There is no
server, no real shuffle commitment, no real chips. It's there to prove the look and feel.
Verified: a 2,000-hand headless simulation showed chips are conserved (no money leaks) and split
pots are handled — but again, this is the *demo* engine, not the money path.

## What does NOT exist yet (the gap you're closing)

1. **Authentication.** No login. Everyone is "Guest Player". Telegram identity is not verified
   and no player account is created. *(Owner's stated priority: auth comes first.)*
2. **Real wallet.** The wallet screen shows ₮0.00 and its buttons are inert. Nothing talks to
   `financial-core`. No real deposit address, no withdrawal request.
3. **Live game connection.** The table never contacts `game-server`. No WebSocket client, no
   server-authoritative hands, no real settlement.
4. **Real lobby data.** Game list, player counts, and jackpot figures are hardcoded, not fed by
   the server.
5. **The other 10 game screens.** Only the Hold'em table exists in the UI. Baccarat, Niu Niu,
   Dou Di Zhu, Red Packet, etc. have catalog entries but no table screens.
6. **Deployment.** Nothing is hosted. Frontend→Netlify, backend→Heroku (×2), DB→MongoDB Atlas
   are the chosen targets but not set up. **Blocked on Victor providing accounts/secrets.**
7. **Screens from the plan not started:** VIP page, Agent Center, admin/ops, onboarding/first-open.

## Guardrails while you work

- **Staging is test-money / testnet only, password-gated.** Do **not** expose real deposits or
  withdrawals on any public URL before the security review (that's W11 in the plan). When you
  wire the wallet, point it at testnet.
- Keep the **demo engine** working until the live feed replaces it — don't delete `useDemoHand`
  / `pokerEngine` until `/table/:id` renders real server hands, so the table is never broken on
  `main`.
- Anything touching money must respect the **iron rules** in [01-project-overview.md](01-project-overview.md).
