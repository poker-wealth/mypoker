# MYPOKER — Team Handoff

Welcome, **Samuel** and **Esther**. This folder is your starting point. It explains what the
project is, how the code is laid out, exactly where the previous work stopped, and what to
build next — broken down day by day for the coming week.

Read these in order the first day:

| # | Doc | What it gives you |
|---|-----|-------------------|
| 1 | [01-project-overview.md](01-project-overview.md) | What MYPOKER is, the specs behind it, the non-negotiable "iron rules", and overall status. |
| 2 | [02-architecture.md](02-architecture.md) | The monorepo: three packages, what each does, how they talk to each other. |
| 3 | [03-getting-started.md](03-getting-started.md) | Install everything and run the whole stack locally, step by step. |
| 4 | [04-frontend-guide.md](04-frontend-guide.md) | Deep dive on the `frontend/` app: branding, components, routing, the poker table. |
| 5 | [05-where-we-stopped.md](05-where-we-stopped.md) | The exact current state — what is real, what is a demo/mock, what is not wired yet. |
| 6 | [06-week-plan.md](06-week-plan.md) | **Your work.** Monday→Saturday, task by task, split between the two of you. |
| 7 | [07-git-workflow.md](07-git-workflow.md) | How we branch, PR, review, and merge. Read before your first push. |

## The short version

- **MYPOKER** is a provably-fair, multi-game online poker/casino platform delivered as a
  Telegram Mini App (plus web). Real money runs on the Solana/TRON chains; fairness is
  verifiable on-chain.
- The **backend is built and tested** (~482 tests): two Node/TypeScript services —
  `game-server/` (the games) and `financial-core/` (the money). All 11 games, the ledger,
  jackpots, insurance, anti-bot, agents, etc. exist and pass tests.
- The **frontend is early**: a branded React app shell with the four main screens and **one
  playable poker table** driven by a *client-side demo engine*. It is **not yet connected to
  the real backend**, there is **no authentication**, and the wallet is **UI only**.
- Your week is about closing that gap: get the backend running and deployed, add Telegram
  login, wire the real wallet, connect the table to the live game-server, and build the
  remaining game screens.

## How we work (important)

- We work **Monday to Saturday**.
- You push to a **feature/** or **fix/** branch and open a **PR to `main`**.
- **Victor reviews and tests every PR** before it is merged. Nothing goes to `main` unmerged
  by you directly. See [07-git-workflow.md](07-git-workflow.md).
- Money correctness is sacred. If a change touches balances, ledgers, or settlement, call it
  out explicitly in the PR. Read the iron rules in doc 01.

## Who to ask

- **Victor** (project lead) — reviews PRs, owns priorities, holds the deployment accounts
  and secrets. Anything blocked on credentials or a product decision goes to Victor.
