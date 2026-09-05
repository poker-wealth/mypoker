# MYPOKER — working notes

Telegram Mini App poker platform. Three packages, one repo:

| | what it owns |
|---|---|
| `financial-core` | money. Accounts, ledger, settlement, withdrawals, leagues. **Facts.** |
| `game-server` | games, the live table WebSocket, and the gateway (auth, admin, lobby). **Rules.** |
| `frontend` | React 19 + Vite + Tailwind v4. The Mini App itself. |

## Iron rules

1. **All money moves through `transfer()`** in financial-core, which enforces the clearing whitelist, idempotency and overdraft. No direct balance writes, ever, anywhere.
2. **No floats on money.** `Money` / `Decimal128` / integer micro-units end to end. A rounding error introduced by a helper is indistinguishable from theft.
3. **No blockchain in the deal path.** Chain work is notarization, off the critical path.
4. **Facts vs rules.** financial-core returns figures and holds no opinion; game-server derives reputation bands, VIP tiers, alert severity, rake bands. A second copy of a rule eventually gives a second answer.
5. **Money-touching code is senior-reviewed before merge.** Say so in the PR.

## Read `docs/TRAPS.md` before writing code

Bugs this project has actually shipped, grouped by pattern: money units that
look identical in a debugger, `?? 0` turning "unknown" into a claim, the
doubled currency mark, build-time constants read where a runtime value was
meant, checks that pass because they don't do the real thing.

It is short and every entry is a real incident. Reading it costs less than
rediscovering one of them.

## The spec is the authority

`docs_extracted/*.txt` — the real specs. Generated, not committed: run `python extract_docx.py` against the `.docx` files at the repo root if missing.

**`docs/handoff/*` is NOT authority.** Those summaries have been wrong repeatedly — they describe controls as "enforced" that nothing implemented. Same for code comments. Verify what code *does*.

When the spec is silent, say so, pick the shape that fits existing patterns, and label the assumption. Don't invent a number and let it read as spec.

## Verifying

```bash
npm run verify          # typecheck + lint + test — financial-core and game-server ONLY
cd frontend && npx tsc -b && npx eslint src && npx vite build && npx vitest run
```

`npm run verify` does **not** touch the frontend. The frontend has its own vitest suite, and its `build` runs `check:locales` (every key in all 8 locales) and `check:no-localhost` (rejects a bundle with a baked-in localhost API URL).

**Run `npm test`, not `npx jest`.** Both backend packages pin `--runInBand`; calling jest directly skips it, and parallel in-memory Mongo instances then fail whole suites at setup on a loaded machine — which looks alarming and means nothing.

### Both `verify` scripts are RED on `main` — check before blaming yourself

As of 5 Sep 2026, neither gate passes on a clean checkout. Know this before you
spend an hour bisecting your own change.

- **`npm run verify` (root) dies at lint and never reaches the tests.** 12
  errors: `no-explicit-any` in `game-server/src/live/slots-room.ts` and
  `test/games/dou-di-zhu/dou-di-zhu-game.test.ts`, `no-require-imports` in
  `test/fairness/rule-stamp-propagation.test.ts`. Because lint runs first, a
  green suite is invisible behind it. **To actually gate on tests, run
  `npm test` inside each package.**
- **`mobile/ npm run verify` dies at `check:parity`** —
  `PARSE FAILURE: could not find the AdminShell ("path: '/admin',") children
  block in router.tsx`. The router now builds those routes as
  `const adminChildren = [...]`; the checker still expects them inline. So the
  parity guarantee of TRAPS §9 is **not currently being checked**.

**The parity one is already fixed on an unmerged branch** — `432007f` on
`feat/email-otp-confirmation--samuel`, pushed, not on `main`. That same commit
also fixes a live bug: on `main` every lobby table advertises **`Blinds 0/0`**,
because `Lobby.tsx` runs chip stakes through `formatMicros`, which divides by a
million. Merging that branch clears both.

Both are recorded in `docs/TRAPS.md` §25. Before writing anything in the lobby
or the parity checker, run `git log origin/main --oneline -- <file>` and check
the branch list — a fix sitting unmerged looks exactly like a bug nobody found.

Also known: **16 pre-existing eslint `any` errors** in
`frontend/src/components/games/`. Not yours.

## Local traps

- A crashed test run leaves `mongo-mem-*` dirs in the temp dir; a later start then fails with `fassert()`. Clear them.
- `MONGO_TLS=false` for a local mongod — the default is TLS on and fails confusingly against localhost.
- Git Bash and node disagree about `/tmp`. Use Windows-native paths (`C:/Users/...`) in anything node reads.
- `JWT_SECRET` must match between financial-core and the gateway or every call 401s.

## Conventions

Branch per task off `main`, one thing per PR, `--samuel` suffix. PR descriptions carry: what changed, **what was verified and how**, what is still open. That doubles as the handoff artifact for the next session.

Claim only what was checked. "Tests pass" is not "it works" — say which was done.
