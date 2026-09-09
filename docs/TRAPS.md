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
vulnerability was live. It was written that only `test/auth/user-store.test.ts`
catches it — **that file does not exist in the repo, and `game-server` has no
Mongo dependency to have run it with. Nothing exercises this today. See §24.**

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

**Update, 26 Aug 2026: the Google fix IS on `origin/main` now.** The audience
allow-list and the fail-closed 503 are both there — checked with
`git show origin/main:game-server/src/gateway/auth.ts`, and confirmed against a
running gateway, which answers 503 "Google sign-in is not configured" rather
than accepting a token. Session handoffs were still describing it as unmerged
and exploitable weeks after it landed, which is the same failure in the other
direction: the note outlived the bug. **Check `origin/main` before repeating
either claim** — that this entry had to be corrected is the point of it.

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
- **Git Bash and node disagree about `/tmp`** — and so does Python. A heredoc
  written to `/tmp/x` from Bash is at a Git-Bash-internal path that a
  `python -c` in the same command cannot open, and the error is a bare
  `FileNotFoundError` on a path that Bash will happily `cat`. Use
  Windows-native paths (`C:/Users/...`) in anything not-Bash reads.
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

---

## 14. A guard that is a render behind is not a guard

The withdrawal submit button gated on react-query's `isPending`. That is
state: it flips on the next render, so two taps in the same frame both ran
`submit()` and filed **two genuine withdrawal requests**, each individually
valid, both landing in the ops approval queue.

The idempotency that existed did not help and was never going to. It lives at
the **ledger** stage (`idempotencyKey: withdraw:${withdrawalId}`) and stops one
withdrawal being *paid* twice; it never sees this race, because each POST mints
a fresh withdrawal id. Two requests are two ids are two keys.

For anything that must fire once, the guard has to be **synchronous** — a
`useRef` checked and set before any await. Clear it in `onSettled`, not
`onSuccess`, or a failure locks the button forever.

The same race exists on every mutation in the app gated only by `isPending`:
address registration (48h consequence), league creation, buy-in.

---

## 15. Options that default to on, and silently do nothing

React Query's `refetchOnWindowFocus` and `refetchOnReconnect` default to
**true**. On React Native they do nothing at all unless `focusManager` is wired
to `AppState` and `onlineManager` to a network source. Neither was.

So the configuration read as correct while every screen froze on backgrounding
— reopen after an hour and see hour-old balances. That is worse than the option
being off, because nothing looks wrong.

`focusManager` is now wired. **`onlineManager` is not** — it needs `netinfo` or
`expo-network`, neither of which is a dependency, and nothing was installed to
fake it. A genuine network outage still triggers no refetch on return.

The general form: a cross-platform library's defaults are written for the web.
Before trusting one on native, find what it subscribes to and check that thing
exists here.

---

## 16. Frozen and live look identical unless you make them differ

`TableScreen` consulted the socket `status` **only before the first snapshot**.
After that the felt, stacks, pot and action bar all rendered from the last
snapshot with nothing tied to the connection. Meanwhile `sendInner` silently
returned when the socket was not OPEN.

So: ride a lift, come back, and the table looks perfectly live — frozen at the
last hand, "your turn" possibly still showing — while every tap on Fold or Call
evaporates and the server's disconnect-grace timer runs the player down.

Two rules from this. **Stale data must be visibly stale**, especially money.
And **a control that cannot act must not look actionable** — dim it, disable
it, say why. Silently dropping a command is the worst of the three.

Note what was NOT done: `states.offline` / `states.backOnline` were left unused,
because with `onlineManager` unwired the app cannot know device network state.
Using them would have claimed knowledge the app does not have — the same class
of lie as §15.

---

## 17. One null field killed the whole app

There was no error boundary anywhere in `mobile/`. Combined with unguarded
reads on server data — `hit.accountId.length`, `seat.stack.toLocaleString()` —
a single null field in a single row took the app down in release: no message,
no recovery, force-quit only.

An app that talks to a server needs one boundary at the root as a floor, and
optional-chaining discipline wherever a server field is read. Neither is
optional on a money app, where the crash lands on someone mid-withdrawal.

Related: `money()` had no finite guard while its sibling `moneyFromDecimal`
did, so a missing micro-USD field rendered **₮NaN**. It now returns an em dash
— and `money(0)` still prints `₮0.00`, because a real zero is a figure and an
absent one is not.

---

## 18. The keyboard is part of the layout

There was no `KeyboardAvoidingView` anywhere in the app, against eight files
containing `TextInput`, and `Sheet`'s body was a non-scrolling `View`.

On iOS the keyboard slides **over** a bottom-anchored modal, so the withdrawal
amount field was hidden behind the keyboard the moment it was tapped, with no
scroll to recover. Android escaped only by luck, via `windowSoftInputMode`.
The login screen's submit button was likewise unreachable in sign-up mode.

Also: no safe-area handling existed, so the action bar sat inside the iOS
home-indicator swipe zone — where a swipe-to-home during your turn is a fold.

When adding any input, ask what the keyboard covers, and put
`keyboardShouldPersistTaps="handled"` on the scroller — without it the first
tap on a button only dismisses the keyboard.

---

## 19. It compiled, it typechecked, and it could never have worked

Two defects in one change, both invisible to `tsc`, `eslint` and the unit
tests, both found within minutes of running the real thing against a real
server.

**A regex built in a template literal silently lost its backslash.** The code
read ``new RegExp(`^\d{${OTP_LENGTH}}$`)`` — which looks exactly right. A
template literal eats the escape, so the pattern compiled to `^d{6}$` and
matched the literal string "dddddd" and nothing else. Every genuine
confirmation code was rejected. It failed *closed*, so nothing crashed and no
type was wrong; a unit test on the helper is what caught it, and only because
the test asserted on real six-digit input rather than on the regex.

Build patterns from a plain literal (`/^\d+$/`) and check length separately.
If a pattern must be interpolated, `String.raw` it.

**A service-to-service URL was missing its mount prefix.** financial-core
mounts its ENTIRE router under `/api/v1` (`http/app.ts`), and every existing
gateway → core call carries it. A new call written as `${base}/internal/...`
typechecked, linted, and passed its tests — the tests inject a fake mailer, so
the URL is never exercised — and would have 404'd in production, turning every
sign-up into "we could not send the confirmation email" with nothing saying
why. Note the trap underneath: the reverse direction genuinely has no prefix,
because the gateway mounts its internal routes at the root. Two services, two
mount points, no convention to lean on.

**The pattern:** a string that is only ever read by another process is not
covered by any check that runs in this one. The way to find out is to run both
and watch the call happen. Both of these were found by standing the stack up
locally — in-memory Mongo shared over TCP, a throwaway SMTP server capturing
the actual message — which took less time than either bug would have taken to
diagnose from a production report.

## 20. A rule enforced on one door is not enforced

**Suspension was checked on the password sign-in and not on Google.**
`/auth/login` runs `isSignInAllowed`; `/auth/google` took whatever
`userStore.oauth` returned and minted a session from it. So an administrator
could suspend an account and the player would be back in one click on "Sign in
with Google" — a ban that any banned player would discover was optional within
about thirty seconds.

Nothing in the suite would have caught it. Every existing sign-in test used the
password path, so the Google route had full coverage of the questions it was
already being asked and none of the new one.

The fix that mattered was not adding the check — it was changing `oauth()` to
return a **verdict** rather than an identity, so the caller cannot reach the
identity without stepping past the refusal. A third sign-in method now cannot
skip it by accident; it will not compile.

**And the near-miss underneath:** the first version of that fix re-read
`user.suspendedAt` inline instead of calling `isSignInAllowed` — a second copy
of the rule, three lines from the file that exists to be the only copy. It was
caught by mutation-testing the shared rule and noticing the Google path stayed
green, which is the whole reason to break a guard on purpose rather than trust
that a passing suite means it is load-bearing.

**The pattern:** when you add a rule, enumerate the doors. Auth had two and only
one was counted. Then make the type system carry the rule, because the next door
will be added by someone who never read this.

## 21. A check that only runs inside the process cannot see a browser's rule

**The admin edit form failed with "cannot reach the server", and nothing was
down.** The gateway advertised `Access-Control-Allow-Methods: GET, POST,
OPTIONS`. The edit route is a `PATCH`. The browser reads that list *before*
sending, refused, and `fetch` rejected with no response at all — which the
client reports, correctly, as unreachable. The message was true and pointed at
the network instead of at a header.

All twenty-two route tests for that surface passed. Supertest calls the Express
app directly and never performs a preflight, so the whole suite was blind to a
rule only a browser enforces. Adding a verb to a router is therefore two
changes, and the second one has no local consequence at all.

The test that now covers it enumerates every verb the router actually mounts
and asserts the preflight allows each — so a future `DELETE` fails in CI rather
than in someone's browser.

**A near-miss inside the fix:** the first version of that test asserted "more
than 3 verbs are mounted" as a sanity floor. The app mounts exactly three, so
the floor was a number nobody had checked, and it failed for the wrong reason.
It now names the set.

## 22. A cached identity is a claim that stops being true

**An administrator renamed a player and the player's own app kept the old
name.** The session player object is written to `localStorage` at sign-in and
never rewritten; every screen reads it from there. `/auth/me` returned the new
name the whole time — nothing was consulting it.

A reload did not fix it, which is what makes this worse than a stale cache: a
reload rehydrates the same object from storage. The old name would have
survived until the player signed out and back in, and nothing on their screen
would suggest that was the remedy.

**The same bug in a worse costume:** `role` lives on that object too. Grant an
account `ops` and its cached copy still says `player` — and `AdminShell` gates
on exactly that copy, so the panel refuses its own newly-created administrator.
Found by chasing the display name; the role case would have been reported as
"the admin panel doesn't work for me" and diagnosed nowhere near here.

The fix is one `refreshPlayer()` on boot for a restored session. The general
shape: anything a SECOND party can change about you cannot be cached at first
sight and trusted forever.

## 23. A guard on one rail is not a guard

**Suspension revoked HTTP sessions and did nothing on the live table.** The gate
was consulted in exactly one place — `requireAuth` — so a suspended player's
REST calls started failing while they carried on playing at the felt with the
token they already held, for up to the full 24-hour TTL. That is precisely the
window the feature was built to close.

Eighteen tests covered suspension and every one of them passed, because they
mount a bare HTTP route and never open a socket. The socket handshake verifies
a JWT signature and expiry and asks nothing else.

This is #20 ("a rule enforced on one door is not enforced") a second time, at a
larger scale: there the two doors were password and Google sign-in, here they
are two entire transports. The lesson did not generalise on its own, which is
the point worth writing down — enumerate the RAILS, not just the routes, and
remember that a WebSocket authenticates once at connect while HTTP
re-authenticates on every request.

**Two more from the same review, both the shape of "the guarantee is stated in
a comment and not implemented":**

- Every admin write applied BEFORE its audit entry was written. The audit
  store's own header says a failed log should fail the request "rather than
  leave an unattributed edit" — but by the time the log ran, the change was
  already committed. A failed audit insert gave a 500 on a change that had
  happened, with no record. The comment described an intention; the ordering
  contradicted it.
- `requireAdmin` trusted the `ops` claim in the token, so demoting an
  administrator did nothing until the token expired. Suspension had
  per-request revocation and role did not — which meant the only way to cut off
  a rogue admin was to suspend them, and (see above) that would not have
  reached their socket either.

**And a cache that only ever grew.** Both the suspension gate and the override
store refreshed entries on expiry without ever removing one, so each held a
slot per distinct player for the life of the process. Not exploitable; a leak
that gets worse exactly as the platform succeeds.

**The pattern across all four:** each was a control that looked complete from
inside the file it lived in. What found them was asking, from outside, "what
else reaches this state?" — a second transport, a failed second write, a
second kind of privilege, an unbounded lifetime.

## 24. The document that cites a guard which does not exist

**§1 of this file names `test/auth/user-store.test.ts` as the only thing that
catches the reclaim/account-takeover class. That file is not in the repo.**

Verified 5 Sep 2026: `find . -iname "user-store.test.ts"` returns nothing but
compiled `dist/` artefacts of the *source* file. `game-server` has no
`mongodb-memory-server` in `dependencies` or `devDependencies`, is not hoisted
one from the workspace, and its `jest.config.js` has no `setupFilesAfterEnv`,
no `globalSetup` and no database bootstrapping at all — so that test could not
have run against real Mongo even if it existed.

`game-server/test/auth/email-confirmation.test.ts:27` points at the same
missing file, and its own docstring says it deliberately does NOT cover that
ground because "that runs against real Mongo in `user-store.test.ts`".

So **nothing currently exercises `userStore`'s real persistence**, and two
documents say otherwise. This entry is §7 ("comments that describe intentions,
not code") happening to TRAPS.md itself — the file that exists to stop the
pattern acquired it.

For contrast, the claim is only half true across the repo: `financial-core`
*does* have a real harness — `mongodb-memory-server` ^10.1.3, a
`MongoMemoryReplSet` per file via `test/db-helper.ts` (a replica set, because
`transfer()` needs transactions), and 34 of its 46 suites use it. The gap is
`game-server`-only, where all 137 suites use hand-written fakes.

**What to do:** before citing a test as the thing that proves a rule, open it.
And when writing "only X catches this", make X a path someone can click.

## 25. A check that always fails is a check nobody runs

Two of this project's own gates are red on `main`, which means the discipline
they encode is not actually running.

- **`npm run verify` (root) never reaches the tests.** It dies at lint with 12
  errors — `no-explicit-any` in `slots-room.ts` and `dou-di-zhu-game.test.ts`,
  `no-require-imports` in `rule-stamp-propagation.test.ts`. Lint runs before
  test, so a green suite is invisible behind a red linter. Anyone following
  the root `CLAUDE.md` runs this, sees red, and cannot tell whether they broke
  it.
- **`mobile npm run verify` dies at `check:parity`** with
  `PARSE FAILURE: could not find the AdminShell ("path: '/admin',") children
  block in router.tsx`. The cause is a refactor: `router.tsx` now builds the
  admin routes as `const adminChildren = [...]` (line 31) and the checker still
  expects them inline.

  **Correction, same day: this is already fixed — on a branch that has not
  merged.** `432007f` ("fix(lobby): stop advertising blinds of 0/0, and repair
  the parity check") on `feat/email-otp-confirmation--samuel` teaches the
  checker the hoisted-array shape. It is pushed. It is not on `origin/main`, so
  `main` is still red. Which makes this §6 again — and makes the paragraph
  above an example of the thing §6's own update warns about, a note that
  outlives the bug. Both halves of that mistake are now on record in the same
  entry, deliberately.

The second one is the sharper lesson. `check:parity` was written **because**
parity had been claimed wrongly three times (§9), and it fails loudly by
design — its own header says the discipline is "to fail loudly rather than
quietly". It did exactly that. But a gate that fails for an unrelated reason
gets stepped around, and parity has therefore gone unverified since the router
was refactored.

**What to do:** a check that has been red for a while is not a check. Either
fix it the day it goes red, or delete it — leaving it is how a suite teaches
people to ignore failures. And when refactoring a file, grep for scripts that
*parse* it; `router.tsx` and `BottomNav.tsx` are read by a checker that no
compiler will tell you about.

## 26. A token cannot be repainted alone if its siblings are hardcoded

Found while repaletting to the HHPoker reference (v3).

`--felt` looks like an ordinary design token, so changing its value looks like
a one-line change. It is consumed in exactly two places, both of this shape:

```css
radial-gradient(ellipse at 50% 42%, #1e3f74 0%, var(--felt) 45%, #0a162c 78%, #060d1c 100%)
```

Three of the four stops are hardcoded blues. Repainting `--felt` maroon
produces a blue-to-maroon-to-blue gradient — visibly broken, and invisible to
`tsc`, to eslint and to the build, all of which passed. Only opening the screen
would show it.

`PokerCanvas.tsx` has the same shape independently: it hardcodes `#12233f` (the
literal value of `--felt`) plus two more stops, so it would not have moved at
all.

**What to do:** before changing a token's value, grep for its consumers and
check what it is being *mixed with*. A token surrounded by literals is not a
token; it is one stop in a hardcoded palette. And a value duplicated as a
literal somewhere else (`#12233f` in a canvas) will silently disagree the
moment the token moves.

### §25 postscript — the same commit is holding a live bug off `main`

`432007f` also fixes something worse than a red gate. On `origin/main`,
`Lobby.tsx` renders blinds as:

```ts
blinds: `${formatMicros(t.stakes / 2, 0)}/${formatMicros(t.stakes, 0)}`
```

`formatMicros` divides by 1,000,000 and `stakes` is **table chips** — a big
blind of 20. So every real table in the lobby on `main` advertises
**`Blinds 0/0`**, which is the exact incident §2 of this file describes in the
past tense, as though it had been dealt with. It was dealt with. On a branch.

The fix threads `smallBlind` through `room-state.ts`, `lobby-service.ts`,
`live-sync.ts` and `api/lobby.ts` and replaces the arithmetic with a
`formatBlinds` helper that refuses to guess. It has been pushed and unmerged
long enough for a later session to rediscover the bug from scratch.

**The compounding cost:** a second developer planning lobby work off `main`
sees a bug that is already fixed, and either rebuilds the fix — conflicting
with the branch — or records it as new, which is how this entry came to exist.
`git log origin/main --oneline -- <file>` before writing anything is cheaper
than either.
### §26, continued — and the copies I did not find were the ones outside `src/`

Two days after writing the above I found the rest of them, and the way I found
them says more than the bug did.

The v3 repalette moved `--bg` and `--brand`. I audited the change by grepping
`frontend/src` and `mobile/src` for the old hexes, found the hits were all in
felts and per-game art, reasoned correctly that those were someone else's, and
called the audit clean. Four copies were sitting outside both directories:

```
frontend/index.html   <meta name="theme-color">      #0d0d1a
frontend/index.html   #splash { background }         #0d0d1a
frontend/index.html   #splash-mark drop-shadow       rgb(187 92 246)
mobile/app.json       expo-splash-screen background  #0d0d1a
mobile/app.json       android adaptiveIcon background #0d0d1a
```

So every cold start painted the OLD brand, held it for the length of the boot,
and then snapped to the new one — on both platforms, on the first screen a
player sees. `tsc`, `eslint`, `vite build`, `check:locales`, `check:parity`,
1312 backend tests and a full hand-written audit were all green throughout.
None of them compares two files.

**Three things worth keeping from this.**

*The warning was already there and already correct.* `index.html` carried the
sentence "If the brand colours change, this block changes too", in a comment
block explaining exactly why the duplication was necessary. I read that file,
changed the brand, and did not act on it. A comment addressed to a future
reader is not a control — §7 again, from the other side: not a comment that
lies, a comment that tells the truth to someone not looking for it.

*The audit's scope was the bug.* `src/` is where components live, so `src/` is
where a colour audit goes looking. But the boot screens exist precisely BECAUSE
they run before the app does, which is the same reason they cannot be in `src/`.
The files most likely to hold a duplicate were the files structurally guaranteed
to be outside the search. When auditing a token, search the repo, not the source
directory.

*It is a check now.* `frontend/scripts/check-splash.mjs` reads `--bg` and
`--brand` out of `index.css` and fails if any of the five copies disagrees; it
runs in `frontend npm run build` and in `mobile npm run verify`. Mutation-tested
in both directions — each of the five drifts is caught, and renaming the CSS
rule produces a loud PARSE FAILURE rather than a silent pass, which is the
mistake `check-parity` made (§25).

---

## 27. An image with no height has whatever height the viewport gives it

The owner opened the live site and could not see the bottom of his own banner
without scrolling. The hero slides were:

```tsx
<img src={s} className="h-auto w-full shrink-0" />
```

No height. So the slot's height was viewport width ÷ the art's aspect ratio,
and the art is 1024x569. On the 1920-wide screen he was using that is a 1067px
banner sitting under a ~110px header — the bottom edge landed about 300px past
the fold. On the 1280-wide laptop it was authored on it very nearly fitted, and
looked fine.

**`h-auto w-full` is not a layout, it is a ratio.** Anything sized that way is
only ever "correct" at the width you happened to look at it. A slot that must
relate to the fold needs a viewport-height term in it — ours is now
`min(56vw, 58svh)`, where the `svh` half answers the complaint and the `vw`
half stops it going letterbox-thin on a phone.

Two related things this surfaced:

*The obvious fix was the wrong one.* Capping height with `object-fit: cover`
crops. Cropping this 1.80 image into the ~3.2 slot a wide desktop implies takes
44% of its height off, and the tagline sits about 78% down — it would have gone.
`publicSite.css` already carried a note about exactly this happening once
before, a 2.05 banner cropped into a 1.68 box losing the wordmark off the left.
The fix that keeps the whole picture is `contain`, with the same file blurred
underneath to fill what is left over: no crop, no second request, no new art.

*Two slides, two ratios.* hero-1 is 1.80 and hero-2 is 2.05, so the carousel
changed height as it rotated and moved the page under the reader. Nobody had
reported that, and it went away for free once the slot was fixed. Sibling art
in one carousel needs one ratio, or one fixed slot.

---

## 28. A probe that opens a media pipeline is not a probe

Each of the four welcome tiles carried this, to find out whether its file
exists:

```tsx
<video src={src} preload="metadata" className="hidden" onError={...} />
```

`className="hidden"` is `display: none`, which does not stop a fetch. Four of
these mount four media pipelines against four MP4s totalling **28 MB** on every
page load, and because an MP4's `moov` atom sits at the end of the file,
"metadata" can mean range-requesting deep into a 14 MB clip. The intent was
good — a missing file should downgrade the tile, never show a dead player — and
the cost was invisible in the source, because the element looks like markup and
not like a download.

**To ask whether a file exists, ask.** `fetch(src, { method: 'HEAD' })` answers
the same question in a few hundred bytes and downloads no video. Same
degradation, same UX, ~28 MB less traffic.

The general form: `display: none`, `hidden`, `visibility: hidden` and
zero-size all hide a thing from the reader and none of them hides it from the
network. If it has a `src`, it is a request.

---

## 29. A deliberate delay does not show up in any performance measurement

The same "page is slow" report had four causes. Three were the usual kind —
3.2 MB of PNG, the video probes above, a 1.42 MB unsplit JS bundle. The largest
was this, in `src/lib/splash.ts`:

```ts
const MINIMUM_VISIBLE_MS = 2200;
```

A hard floor. Plus a 320ms fade, so **nothing could appear in under ~2.5s**, no
matter how fast the app was ready — and the faster you made it, the more of the
2.5s was pure waiting. It was a considered decision with a correct rationale
written above it (the coin-spin needs about two-thirds of a turn to read as
intentional rather than as a flicker), and it is right *inside Telegram*, where
you tapped an app and it is opening. It is wrong on the open web, where nobody
following a link asked for a title card.

**No bundle analyser, asset audit or lighthouse-style byte count can see a
`setTimeout`.** When someone reports slowness, grep for the delays you wrote on
purpose before optimising the ones you did not. The fix was not to delete the
decision but to scope it: 2200ms under `isTelegram()`, 300ms in a browser.

And a second-order note: `isTelegram()` is now called at dismissal rather than
at module load. `splash.ts` is imported by `main.tsx` before `initTelegram()`
runs and `window.Telegram.WebApp` is populated by a script tag, so evaluating it
during module evaluation is §14 again — a guard a beat early — and it fails in
the direction that silently costs the Mini App its launch screen.

---

## 30. Two correct changes, one bug between them

Shortening the splash floor to 300ms is correct. Code-splitting the routes is
correct. Together they are a white screen.

The sequence: React commits an empty shell, the two rAFs pass, the splash fades
at 300ms — and the matched route's lazy chunk is still in flight, so the
visitor watches nothing until it lands. Neither change has this problem alone.
The old 2200ms floor was accidentally covering the chunk fetch, and the unsplit
bundle meant there was never a chunk to fetch.

The fix is to dismiss on the real event rather than on a timer that used to
correlate with it: wait for `router.state.initialized`, which flips only once
the initial match *and its lazy module* have resolved. Already true when nothing
had to be fetched, so warm loads are untouched. With an 8s ceiling, because a
splash that never leaves is worse than one that leaves early.

**This is the case the audit-between-tasks rule exists for.** Task B did not
break task A; B and A were each fine and their seam was not. Neither diff
reviewed on its own shows it — you only see it by asking what the page does
between the two of them.

---

## 31. §28 has a mirror image: don't unmount the media you do need

§28 removed four `<video>` elements that were mounted at page load and cost
28 MB. The obvious next move — mount the player only when someone clicks it —
is the same mistake pointing the other way, and the owner caught it in a day:

> "When I click the video to view the video, it shouldn't start with video HTML
> tag loader, it should open the video as it is on the reference site."

Our modal was `{playing && <video src autoPlay />}`. Conditional render means
every click **creates a brand-new element**, which starts fetching a multi-MB
MP4 from zero, so what you get is the browser's empty player: a black
rectangle, a spinner, a scrub bar sitting at 0:00. The reference does not:

```js
i("video", { directives: [{ name: "show", value: t.videoState }],
             attrs: { src: ..., controls: "controls" } })
```

`v-show`, not `v-if` — it toggles `display`, the element is in the DOM from
page load with `src` set, and by click time the clip is buffered. It opens
already playing.

**The two failures share one root: `preload` was never the thing being
controlled — mounting was.** Mounting is a blunt instrument for it. The fix
that satisfies both §28 and this one is to make the element permanent, like
theirs, and control the bytes with the attribute that exists for it:

- `preload="none"` while nobody has shown interest — zero bytes, so scrolling
  past the section costs nothing, which is what §28 was protecting.
- flip to `preload="auto"` on `pointerenter` / `pointerdown` / `focus` — a
  desktop hover buys most of a second before the click; on a phone
  `pointerdown` fires before the tap completes, which buys a little.
- never unmount, so the buffer survives closing and reopening.

Two details that bite:

*`load()` must run after the render that sets the attribute.* Calling it while
`preload` still reads `"none"` is a request the browser may ignore. It belongs
in an effect keyed on the warm flag, not inside the handler that sets it.

*`autoPlay` has to go with the change.* An element that outlives the modal
would fire its autoplay attribute on a hidden video at page load. Call `play()`
from the open handler instead — which is also the user gesture that autoplay
policy actually accepts.

And a smaller one found while reading their stylesheet: the comment in our
player claimed the reference had "no dark wash behind it" and that we were
matching them by leaving it out. Their CSS says `.mask { background: #0c0e0f;
opacity: .5 }`. It was §7 — a comment asserting a fact about someone else's
code that nobody had checked. When a comment justifies a choice by citing a
reference, cite the line.

---

## 32. Code-splitting the routes blinded the parity checker

`check-parity.mjs` is the only thing standing between us and the web and the
app quietly growing different screens. It reads `router.tsx` and `App.tsx` and
compares them. It reads them **as text**, with regexes anchored on the shape
the router happened to have:

```js
childrenBlock(routerSrc, 'element: <AppShell />')
const ROUTE_ENTRY_RE = /\{\s*(index:\s*true|path:\s*'[^']+')\s*,\s*element:\s*<(\w+)/g;
```

§29's fix split the routes for page weight, turning every one of them from

```js
{ path: 'games', element: <Games /> }
```

into

```js
{ path: 'games', lazy: async () => ({ Component: (await import('@/pages/Games')).Games }) }
```

Both are correct routers. Only one is a router this checker can read. Every
anchor and both capture groups stopped matching at once.

**What saved it was that the checker fails loudly.** It has an explicit guard —
"extracted zero routes … treat this as broken, not clean" — so it died at
PARSE FAILURE instead of comparing an empty list to an empty list and printing
`parity ok`. A checker written the obvious way, returning `[]` and finding no
mismatches in it, would have gone green on the same commit and stayed green
while the two platforms drifted for a release. That guard is the entire reason
this is a §32 and not an incident.

Two smaller versions of the same thing came out with it, both mine:

- `PARAM_KEY_RE` matched `undefined` and `{…}` but not
  `NavigatorScreenParams<TabParamList>`, so a key plainly declared in
  `navigation.ts` was reported missing from it. Changing a type to the correct
  one broke a checker that was pattern-matching the old one.
- `/download` had no `ACCEPTED_WEB_ONLY` entry. It landed in PR #65 while the
  checker was already dead, so nothing asked for one.

**The rule.** A checker that parses source is coupled to that source's shape,
and nothing tells you when the shape moves — the commit that breaks it is
never the commit that touches it. So:

1. When a check goes PARSE FAILURE, find out whether you caused it before
   filing it under "pre-existing". §25 recorded parity as red on `main` for a
   different reason that had since been fixed; this looked identical from the
   outside and was a fresh regression in the branch's own diff.
2. Fixing it means teaching it the new shape, never loosening it until it
   passes. The difference is testable, so test it: feed the regex both forms
   and confirm it extracts the right name from each, **and** feed it three
   things that are not routes and confirm it returns null. A pattern that
   accepts everything reports no mismatches either.

---

## 33. A filter over a paged list belongs on the server, and its control belongs outside the result

Two mistakes the Messages tabs would have made, both of which look fine on a
screen with a dozen rows in it and are wrong on a real account.

**The filter.** The notification list pages with a cursor. Tabs implemented as
a client-side filter over the fetched pages would show a tab as empty because
the reader had not scrolled far enough — and there is no way to tell that
apart from genuinely empty. The badge would be worse: it would count what was
loaded rather than what exists. So `kinds` became a real query parameter, and
the load-bearing test is not "it filters" but **"it keeps filtering across
pages"** — a filter applied to page one and forgotten on page two passes every
obvious test and fails the first time anyone scrolls.

The related distinction, written into the store: `kinds: undefined` means
unfiltered, `kinds: []` means *none*. A caller that meant to build a filter and
built an empty one should get an empty list, not silently get everything.

**The control.** `Screen` renders its query's pending, error and empty state
*instead of* its children. Put the tab strip inside those children and it
disappears the moment you select a tab that is empty — the reader is now on a
blank screen with no way back to the tabs. That is §12 with the affordance not
missing but destroyed by the state it is meant to escape.

Hence `Screen`'s `header` slot, which renders above all three states. **Any
control that CHANGES a query has to live outside that query's own result** —
tab strips, period switches, search boxes, sort orders. If selecting an option
can empty the list, and the selector is inside the list, the selector is gone
exactly when it is needed.

**One more, smaller.** This screen previously marked everything read on open
with a bodyless `POST /read`. Correct for one list; wrong the moment tabs
exist, because it clears badges for tabs nobody opened — and the badges are the
only reason to have tabs. It now marks the ids actually on screen. Whenever a
screen gains a filter, re-read every write it performs: the writes were
scoped to "the whole thing" when the whole thing was all you could see.
