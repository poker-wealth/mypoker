# 07 · Git Workflow

Read this before your first push. It's short and we follow it strictly.

## The rule

**You never commit to `main` directly.** You work on a branch, open a Pull Request to `main`,
and **Victor reviews and tests it before merging.** That's the whole loop.

```
main  ──●────────────────●─────────►   (only Victor merges here)
         \              ↑
          ●──●──●  PR + review
         feature/your-work
```

## Branch names

- New work: `feature/<short-topic>` — e.g. `feature/telegram-auth`, `feature/niuniu-table`.
- Bug fix: `fix/<short-topic>` — e.g. `fix/wallet-balance-format`.
- One branch per task/PR. Keep PRs small and focused — easier to review and test.

## Step by step

```bash
# 1. Start from an up-to-date main
git checkout main
git pull origin main

# 2. Branch
git checkout -b feature/telegram-auth

# 3. Work. Commit in logical chunks with clear messages.
git add -p
git commit -m "auth: verify Telegram initData on the server"

# 4. Push your branch
git push -u origin feature/telegram-auth

# 5. Open a PR to main on GitHub (see checklist below), then tell Victor.
```

After Victor merges, delete your branch and start the next one from a fresh `git pull`.

## Commit messages

- Present tense, prefixed by area: `auth:`, `wallet:`, `table:`, `lobby:`, `fc:` (financial-core),
  `gs:` (game-server), `docs:`.
- Say *what* and *why*, not just *what*. One line is fine; add a body for anything non-obvious.
- **Money-touching commits must say so.** If a commit changes balances, ledger, settlement, or
  payout, put `[money]` in the subject so it gets extra review.

## Before you open a PR — checklist

Run these in every package you changed. A PR that fails them will bounce.

```bash
# frontend
cd frontend && npm run lint && npm run build

# game-server / financial-core
cd game-server && npm run lint && npm run typecheck && npm test
cd financial-core && npm run lint && npm run typecheck && npm test
```

Then in the PR description include:

- [ ] **What changed** and **why**, in plain language (Victor tests from this).
- [ ] **How to test it** — exact steps/URL/commands to see it work.
- [ ] Screenshots or a screen recording for any UI change.
- [ ] Lint + build + tests pass locally (say which you ran).
- [ ] **Does this touch money?** If yes, spell out the flow and which iron rules apply.
- [ ] Anything you're unsure about or want a second opinion on.

## Reviews

- **Victor is the reviewer** for every PR and tests it before merging. Expect questions and
  change requests — that's normal, push more commits to the same branch to address them.
- You two can (and should) review each other's PRs first to catch the obvious stuff before it
  reaches Victor — but the merge is Victor's.
- Keep the conversation on the PR, not in DMs, so there's a record.

## Don'ts

- ❌ Don't commit secrets. No `.env`, keys, tokens, or mnemonics. `.gitignore` already blocks
  `.env*` — keep it that way. If you leak a secret, tell Victor immediately.
- ❌ Don't commit `node_modules/`, `dist/`, or build output (also gitignored).
- ❌ Don't force-push `main`. Don't rebase/rewrite shared history.
- ❌ Don't merge your own PR.
