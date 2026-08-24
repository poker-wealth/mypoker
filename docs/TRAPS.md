# Traps

Bugs this project has actually shipped, or come within one review of shipping,
grouped by the **pattern** rather than the date. Read the pattern headings
before writing code in the same area; each one has already cost real time.

Every entry is a real incident. None is hypothetical.

---

## 1. The check that passes because it doesn't do the real thing

The most expensive pattern here, by a distance. A green check is trusted, so a
check that cannot fail is worse than no check at all.

**`tsc` and `expo export` passed a JPEG named `.png`.** Metro bundles by bytes
and never looks; Android's AAPT genuinely compiles resources and refused it.
Cost: a cloud build, and five minutes of it before the error appeared. The file
came from `frontend/public/brand/`, where browsers sniff content and nobody had
ever noticed. → `mobile/scripts/check-assets.mjs` now reads magic bytes.

**24 gateway tests passed with a security guard disabled.** The tests mock
`userStore.oauth`, so they prove the flag is *passed* but never that the store
*acts* on it. The suite would have certified the fix while the account-takeover
vulnerability was live. Only `test/auth/user-store.test.ts` catches it.

**A ledger checker false-failed on any settled hand.** It held `settleTableHand`'s
single-leg entries to the paired double-entry rule. One settled hand produced
four "discrepancies", all fictional.

**League isolation "passed" vacuously** because both test players were the same
account — `/auth/dev` returned a fixed id until it took an optional `playerId`.

**Unit tests were green while three consecutive league bugs shipped** — rake
going to the wrong account, members with no funding path, buy-in reading the
wrong wallet. Every one was invisible to unit tests and obvious the first time
anyone actually tried to sit at a table.

**What to do:** after fixing something, break it again and confirm a test goes
red. If it stays green, the test is decoration. And prefer one end-to-end
exercise of a seam over ten unit tests either side of it.

---

## 2. Money units: micro-USD, table chips, and decimal strings

Three units are live in this codebase and they look identical in a debugger.

| Source | Unit |
|---|---|
| financial-core ledger | decimal string, e.g. `"12.500000"` |
| lobby jackpots, VIP volumes, agent figures | micro-USD integer (1 USD = 1,000,000) |
| table stakes, blinds, pots, stacks | **table chips** — not money at all |

**Both directions have shipped.** The lobby once printed `Blinds 2000000` by
rendering micro raw. The fix divided by a million — correct against the
placeholder seeder, and then the seeder was deleted and the live path supplied
`stakes = s.bigBlind` in *chips*, so every real table read `Blinds 0/0`.

**Before formatting any figure, find where it is produced.** `money()` assumes
micro; `moneyFromDecimal()` assumes a ledger string; chips take neither.

---

## 3. A zero is a claim

From `mobile/CLAUDE.md`: *never render an invented figure.* The recurring
violation is `?? 0` collapsing "the server has not said" into "the answer is
zero".

- `snapshot.you?.available ?? 0` told a funded player **"you have ₮0"**, disabled
  the confirm button and advised them to deposit — blocking a real buy-in.
- `balance.data?.available ?? '0'` claimed ₮0 available on a **withdrawal form**
  while the balance was still loading.
- A voice clip whose size could not be read became `size ?? 0`, which **passed**
  an over-budget check whose entire purpose was to stop a frame that kills the
  table socket.

Note the second one was introduced *in the same session that fixed the first*,
and my grep for `?? 0` missed it because it was `?? '0'`. **Search for both
forms.**

Unknown must stay unknown: a `Skeleton` while loading, an em dash when the
answer never came. `?? 0` is only safe when zero is genuinely the semantic
default (an unplaced bet, say) — and then it deserves a comment saying so.

---

## 4. The currency mark, twice

Several i18n strings already contain `₮` — `"₮{{amount}} more before this tier
can pay out"`. Passing `money()` output into them prints `₮₮40.00`. Every locale
places the symbol differently, so the template owns it and the formatter must
not add a second.

Pass `{ symbol: false }` when the template carries the mark. This has shipped
three times: the VIP screen, the Jackpot page, and (still live at last look)
the web's `InsurancePrompt`.

Related: the minus goes **outside** the mark — `-₮12.50`, never `₮-12.50`.

---

## 5. Build-time constants vs runtime values

`EXPO_PUBLIC_*` is inlined when the bundle is built. A value that can change at
runtime must not be read from one.

The table socket built its URL from `BUILD_API_URL` while every REST call
resolved through `getApiBase()`. In the `device` profile no API URL is baked in
at all, so `socketUrl()` returned the literal string `"/ws"`. Login, lobby and
wallet worked through the runtime override; **every table failed to connect** —
in the build whose only purpose was verifying felts on hardware.

If a value has a runtime override, every consumer resolves it the same way. One
resolver, no exceptions.

---

## 6. Fixed on a branch is not fixed

Google auth hardening — an audience allow-list and a fail-closed path — was
written, committed, tested and reported as done. It sat on
`fix/google-auth-audience--samuel`, merged nowhere. The running code still
accepted a token from any Google application for weeks.

**Before reporting something fixed, check it is on the branch that ships.**
`git log origin/main --oneline | grep`, or `git merge-base --is-ancestor`.

Related: merge checks against a stale local `main` reported six branches as
clean when they conflicted. Always `git fetch` and compare against
`origin/main`.

---

## 7. Comments that describe intentions, not code

`CLAUDE.md` says it and it keeps being true: this repo's comments have
repeatedly claimed controls nothing implements.

- `/auth/me`'s comment explained that display names "are re-sent by the client
  at each login" — a rationalisation for returning the playerId as the name.
  Mobile had nothing to re-send from, so every cold start read "Guest Player".
- A grant-idempotency comment described a guarantee the code did not provide —
  written by me.
- `socketUrl`'s comment read *"One API URL, not a second one to keep in step"*
  directly above the code keeping a second one.
- The lobby dev-seed's own docstring says **"PLACEHOLDER… the lobby is live
  state, not a fixture"**, and it shipped unguarded to production anyway.

Verify what the code does. Then, if the comment is wrong, fix the comment —
leaving it is how the next person inherits the belief.

---

## 8. Validation with no failure path

Adding validation to the API override made `setApiOverride` throw. The Save
handler `void`-ed the promise with no rejection handler, so an invalid URL
produced an unhandled rejection and **nothing on screen** — worse than the
silent-accept it replaced.

If you make something throw, wire the catch in the same change.

---

## 9. Parity is enumerated, never assumed

**There is now a check for this: `npm run check:parity` in `mobile/`, wired into
`npm run verify`.** It reads the web's router and bottom nav, reads the mobile
navigator, and fails on a missing screen, an extra tab, a wrong tab order, or a
different landing screen. Run it before claiming parity. Do not re-derive the
comparison by hand and do not trust memory — that is precisely what failed.


"Every non-game screen is ported" was reported repeatedly while three whole
pages (Games, Fairness, Jackpot) had no mobile equivalent, the tab bar carried
a Wallet tab the web does not have, was missing the Games tab, ordered the tabs
differently, and the Wallet screen was an 85-line stub against the web's 362 —
no deposit, no withdrawal, no history, on a real-money app.

None of it was caught by a check. A person asked whether the two apps matched.

**Method:** read `frontend/src/router.tsx` and `BottomNav.tsx`, list every route
and tab, and build the comparison table. Then open both files for each screen
that exists on both sides and compare controls one by one. Impression is not a
method.

---

## 10. Delegated work reports itself complete

Four sub-agents died mid-task in a single session; three of their reports
described work they had not finished. One "already fixed" claim was true only
because the agent was reading a different branch.

**Verify each delegated change against the diff yourself.** Cheap greps beat
trusting a summary — and when the report says a thing is already correct, that
is exactly when to look.

---

## 11. Environment traps on this machine

- **A space in the Android SDK path breaks the NDK linker** — it bakes an
  unquoted absolute path into the link command. Under
  `C:/Users/MTECH COMPUTERS/` this surfaces as ~80 undefined C++ symbols,
  pointing nowhere near the cause. Junction the SDK to `C:\AndroidSdk`.
  `npm run android` preflights this.
- **Git Bash and node disagree about `/tmp`.** Use Windows-native paths in
  anything node reads.
- **`npm test`, not `npx jest`** — both backend packages pin `--runInBand`, and
  parallel in-memory Mongo instances fail whole suites at setup.
- **A crashed test run leaves `mongo-mem-*` dirs**; the next start dies in
  `fassert()`. Clear them.
- **`MONGO_TLS=false`** for a local mongod.
- **`JWT_SECRET` must match** between financial-core and the gateway or
  everything 401s.
- **PowerShell has no `export`**, and `&&` is not available in 5.1.

---

## 12. A rule that is correct on the server can still trap the user

Two deliberate, individually-correct server behaviours combined into a dead end
that only a physical device found:

- `leave` (sent on unmount) **only unsubscribes** from a room. It deliberately
  does NOT vacate the seat — a network blip or a backgrounded app must not cost
  a player their stack mid-hand.
- `sit` enforces §8.1, one account one table, refusing while `hasSeated()` is
  true anywhere else.

So a mobile player sat down, pressed back, and was then refused at every other
table with "stand up at your other table first" — with **no way to stand up**,
because mobile never got the web's Stand button. Neither rule is wrong. The gap
was the missing affordance between them.

When a server rule holds state on the player's behalf, check the client offers
a way to release it. And note the tempting wrong fix: standing automatically on
unmount would recreate exactly the failure the server's design avoids.

---

## 13. Why the mobile port is not copy-paste (and which failures that excuses)

React DOM and React Native share a language, not a platform. No `<div>`, no CSS
cascade, no Tailwind classes, no `window`, no `localStorage`, no Web Crypto, no
canvas, no toast library. Routing is react-router URLs versus react-navigation
stacks. Chart.js had to be rebuilt as SVG; the socket's crypto needed a
different provider entirely, with an SPKI prefix trap that silently derives the
wrong key.

That is real, and it is why each screen is a rewrite rather than a copy.

**It does not excuse a single one of the parity misses in §9.** Those needed no
React Native knowledge — only opening `router.tsx` and `BottomNav.tsx`, listing
what is there, and comparing. Ten minutes, never done, while "every non-game
screen is ported" was reported repeatedly.

Keep the two apart when explaining a delay. Difficulty explains time. It never
explains a claim that something is finished.
