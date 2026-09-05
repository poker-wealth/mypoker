# QA checklist — what is already known

Pre-filled against the full testing checklist, from device testing on
25 Aug 2026 (Android, dev client, local stack via tunnel).

**Only lines actually exercised are marked P.** Everything else is left for the
tester. Where a line is already known to fail, the bug is named so the session
is not spent rediscovering it.

Legend: **P** pass (verified) · **F** fail (known bug) · **B** blocked · **?** untested

---

## 1. Entry & Launch (Telegram Mini App)

| # | Line | Status | Note |
|---|---|---|---|
| 3-4 | HTTPS / correct domain | **B** | `mypoker777.com` serves the Mini App, but **every API path returns `index.html`, not JSON** — SPA fallback. Verified with a direct request. Sign-in and all money calls fail there. |
| 7 | Referral deep link attributed | **F** | `POST /me/referral` exists on the gateway and financial-core but **has zero callers in either client**. Agents can create links; nothing binds a new player to one. |

**Section 1 is blocked until a gateway is deployed.** That is an infrastructure
decision, not a code fix, and it also blocks all of section 14 on iOS.

---

## 3. Languages

| # | Line | Status | Note |
|---|---|---|---|
| 2 | Settings lists 8 languages | **F** | **There is no language picker on mobile.** Device locale is read once at startup. The web has `LanguageSheet`; mobile has nothing. |
| 3 | Currency formatting, single mark | **P** | Fixed and verified. Was `T T 40.00` in three places. |
| 4 | Language persists | **F** | Follows from the missing picker. |

**Thai and Hindi have never been reviewed by a native speaker.** Translations are
good-faith and unverified — worth saying plainly rather than marking P.

Raw-key sweep: 501 keys x 8 locales in sync, enforced by `check-locales`. The
deposit/withdraw block was **English-only in all 7 non-English locales** until
25 Aug — including the "other tokens will be lost" warning. Now translated.

---

## 4. Authentication

Numbered to match the owner's checklist exactly. Re-tested 26 Aug 2026 against
a full local stack — gateway + financial-core on a shared in-memory MongoDB,
with a throwaway SMTP server capturing every message.

**Sign-up is now two steps.** `POST /auth/signup` creates the account and mails
a six-digit code but returns **no token**; only `POST /auth/verify-otp` mints a
session. An unconfirmed account cannot hold a session at all, so it can never
reach a money route — the control is the absence of a token, not a flag some
later call has to remember to check.

**Read the status column carefully. Four of these ten lines are client
behaviour that nobody has exercised**, because there is no browser driver and
no DOM harness in this repo (vitest runs pure logic only — no jsdom, no
testing-library). Everything marked **P** below was driven over the same HTTP
the browser sends, which covers the server completely and the React state
machine not at all.

| # | Line | Status | Note |
|---|---|---|---|
| 1 | Sign up with email + password | **P**, but the expected result has changed | Account created ✅. Balance ₮0 ✅ — `/me/balance` returns `available: "0.000000"` on a fresh confirmed account. **"Lands in the app" is now deliberately false**: it lands on the confirmation screen, and only the emailed code opens the app. That is the change that was asked for, but the checklist row still says otherwise and needs the owner to sign off on the new wording. |
| 2 | Sign-up validation (bad email / weak password) | **F → fixed this session** | Was failing on both halves. A one-character password, a four-character password, `a@b`, and an address containing a space **each created a real account**; only a missing `@` was caught. There was no server-side password rule at all and no real email check — the web form had `type="email"` and no `minLength`, the native form checked both and neither reached the server. Now enforced in `credential-rules.ts` before any row is written. Re-probed: all four refused with distinct, actionable messages, nothing written, nothing mailed. |
| 3 | Log in with email + password | **P** | Verified, including a mixed-case address. |
| 4 | Log in with a WRONG password | **P** | 401 "invalid email or password" — not "session expired", and no session granted. A wrong password on an *unconfirmed* account is also a flat 401: confirmation state is only disclosed once the right password has been supplied. |
| 5 | Sign in with Google | **B** — fail-closed half is **P** | The flow itself still needs `GOOGLE_CLIENT_ID` from the owner, so it cannot be completed. The security half of this line **is** verified: an unconfigured gateway answers 503 "Google sign-in is not configured" and never calls out to Google, so it cannot accept a token from any Google app. That fix is on `origin/main` — see the correction in TRAPS §6. |
| 6 | Telegram identity | **?** — not tested this session | The owner reports it works automatically. `/auth/telegram` was not touched by this work and its existing unit tests pass, but nobody exercised the flow in a real Telegram client this session. Recorded as untested rather than inherited. |
| 7 | Display name after login | **P** | Real display name, not the raw playerId — verified through both the confirm response and `/auth/me`. |
| 8 | Session persistence (close + reopen) | **?** — mechanism present, not exercised | The token is written to `localStorage` under `fp-token` and read at module load, so the mechanism is there and correct on inspection. Whether a real close-and-reopen keeps you signed in has not been observed. |
| 9 | Session expiry returns to Login cleanly | **partial** | Server half verified: no token → 401, forged signature → 401. Client half not observed. The mechanism exists — any 401 fires `setUnauthorizedHandler`, which drops the token and flips status to `anonymous`, and `AppShell` then renders `<Login/>`. "Not stuck erroring on every screen" is precisely the part that needs a person. |
| 10 | Sign out | **?** — mechanism present, not exercised | `signOut` clears the token and the cached player from `localStorage` and sets status `anonymous`. Back-buttoning in should be impossible by construction: `AppShell` is a **render gate**, not a redirect — it returns `<Login/>` in place of the outlet whenever there is no token, so any in-app URL re-renders straight to Login with no race. Not actually clicked. |

### What still needs a person

Lines **6, 8, 9, 10** and the client half of **9**. All of them are browser or
Telegram behaviour. `npm run dev` with `VITE_API_URL` pointed at a gateway
running this branch is the whole remaining step — note that
`frontend/.env.local` points at **4100** by default, which may be an older
gateway process.

### Still blocked on the owner: there is no SMTP account

`financial-core/.env` has no `SMTP_HOST`/`USER`/`PASS`, so **no confirmation
code has ever reached a real inbox** — everything above ran against a local
capture. That proves the message nodemailer builds is correct and proves
nothing about Hostinger accepting it or it surviving a spam filter.
**SAMUEL_V2 task 1 ("email notifications — verify it actually works") is open
for the same reason**, and both unblock together the moment the mailbox exists.

Until then the gateway **fails closed in production**: no SMTP means sign-up is
refused with a 503, never allowed through unconfirmed. Outside production, with
`DEV_AUTH_BYPASS` already on, the code is written to the server console instead
— and to the console only, never to the HTTP response.

---

## 5. Profile / My Account

| # | Line | Status | Note |
|---|---|---|---|
| 3 | Personal Info | **F -> built, untested** | Was: no such screen on mobile. Now built with full parity — avatar (twelve tiles, clear tile, photo upload), display name, read-only email, password change. `check:parity` passes as a result. **Nothing on it has run on a device**: `expo-image-picker` is a native module, so it needs an EAS build before the upload path in particular can be trusted. Not P until then. |
| 8 | Support | **F** | **Absent from the entire mobile app** — no row, no URL config. A player with a money problem has no path to a human. |

---

## 7. Withdraw

| # | Line | Status | Note |
|---|---|---|---|
| 3 | Invalid address rejected | **P** | Server checksum-validates. |
| 5 | Request withdrawal | **?** | Untested end to end. Double-tap now guarded — two taps in one frame previously filed **two** withdrawal requests; the ledger idempotency key never saw that race. |
| 6 | Over-balance rejected | **P** | Server 409. Client previously reported every 400 as "invalid TRON address" while the user looked at an amount field. Fixed. |

---

## 8. Lobby & Navigation

Re-tested 29 Aug 2026 against a running lobby. Numbered to match the owner's
checklist.

| # | Line | Status | Note |
|---|---|---|---|
| 1 | Bottom navigation | **P** | Alliance · Games · Lobby · Data · My Account, same five in the same order on both clients, both landing on Lobby. Note the guard for this had **stopped running**: `check:parity` died with a PARSE FAILURE after the router hoisted `adminChildren` and mounted it at a host-dependent base. Repaired — and it immediately caught a real gap it had been blind to (see below). |
| 2 | Lobby list | **F → fixed on this branch** | Names and seated counts were always right. **Stakes were wrong three ways**, all one root cause — `stakes` is table CHIPS and code written when it was micro-USD was never updated. (a) The web ran `formatMicros()` over it, so **all 13 tables read "Blinds 0/0"**, and the two rows both named "Texas Hold'em" were indistinguishable. (b) The web's filter thresholds were micro-USD against a server comparing chips, so **tapping any blinds filter emptied the lobby** (0 of 13). (c) Nine tables genuinely have no stake level and the server hardcoded `bigBlind: 0` for them, which both clients printed as "0/0". Now: poker reads 10/20 and 50/100 with the server's real small blind, Dou Di Zhu reads its 100 base stake, the other nine read an em dash, and the filter returns 5/5/2/0. |
| 3 | Open a table | **P** | Two halves, both now done. ROUTING: four lists must agree — the tables the server serves, `LIVE_TABLE_IDS`, and the web and mobile felt registries. Cross-checked all four against the live lobby: every served table is openable and routes to its own game, and nothing routes to a game the server does not serve. Player-created (`t-…`) and league (`lg-…`) tables are Hold'em and correctly fall through to the poker felt. RENDERING: **all 13 felts walked on an Android device** (29 Aug) through the dev Felt gallery. Each draws its own game, nothing collapsed, nothing crashed. The four poker ids share one felt by design and did. |
| 4 | Hidden / "coming soon" games | **P** | Rendered as a plain `div` / `View` with a dashed border and a SOON badge on both clients. No press handler, so not tappable. |
| 5 | No dead ends; Back works | **P** | Every `navigate()` target in both clients resolves to a route/screen that exists — no dead taps. Mobile's only headerless stack screen is `Tabs`, the tab root, which correctly has no back; every other screen gets a native one. Web sub-pages sit inside AppShell and always have BottomNav, and the one standalone route (`/table/:id`) carries its own back control. The TRAPS §12 dead end is closed on both platforms, and the whole sequence is now proven end to end by `npm run seat-probe` against a running gateway — sit, the lobby marks that row and only that row, an anonymous viewer sees nothing, a second table refuses BY NAME, stand, seat released, second table accepts. Eleven checks. Hardware back was exercised on a device and behaves as designed: the seat is kept, and the other table refuses. |

### The gap behind "I pressed back and now I cannot join"

Reported from the device, and worth writing down because the RULE was never
wrong. `leave` (back button, unmount) deliberately does not vacate the seat — a
network blip must not cost a stack mid-hand — and §8.1 refuses a second table
while one is held. Both correct. What was missing was any way to find the seat
doing the refusing: the message read "stand up at your other table first" and
stopped there, and the lobby had no idea where you were sitting. With thirteen
tables the only recovery was to open each in turn.

Now: the refusal names the table, and the lobby marks the row with a "Your
seat" badge. Same shape as TRAPS §12 one step further on — a correct rule with
a missing affordance around it.

### What this section turned up beyond the checklist

- **A parity gap that was invisible while the check was broken:** web's
  `/personal` (Personal Info) had no mobile screen. Left FAILING rather than
  added to `ACCEPTED_WEB_ONLY` — it was a real miss, and silencing it is the
  exact failure the check exists to prevent. **Now closed**: the screen is
  built and `check:parity` passes at 22 route/screen rows. Note the check only
  proves a screen EXISTS under that route; that its four sections work is a
  device question, still open (section 5, line 3).
- **Four table controls were English in every locale.** Rebuy / Sit in / Sit
  out / Leave were hardcoded on the web while `table.rebuy`, `table.sitIn`,
  `table.sitOut` and `table.leave` sat translated in all eight files, used by
  mobile since it was built. Fixed.
- **A name was cut to a silent stump.** Red Packet showed the claimant under
  each packet as `name.slice(0, 6)` with no ellipsis, so "YOU (FIXTURE)" read as
  "YOU (F" and two players called Christopher and Christina would both read
  "Christ" — indistinguishable, and looking like whole names. The sweeper list
  below renders the same name in full, which is what made the stump look
  deliberate. Found by walking the gallery. Fixed to truncate on width and say
  that it did.
- **Felt routing is no longer a hand-maintained list.** `registry.test.ts` now
  reads the server's `defaultTables()`, so a new game cannot reach the lobby
  without a felt. Its old docstring admitted the hole: "adding a game to the
  lobby does NOT automatically get covered — add it to both places."

---

## 9. Games

**Texas Hold'em is the only game played end to end on a device.**

| # | Line | Status | Note |
|---|---|---|---|
| 1 | Header shows game name | **P** | Fixed — read the literal word "Table"; five poker tables were indistinguishable. |
| 2 | Empty table draws seats | **P** | **Fixed. This had never worked on either platform** — the server sends only occupied seats. The web still has it. |
| 3 | Seat opens a buy-in sheet | **P** poker / **F** others | The eight non-poker felts **commit `minBuyIn` on tap without showing the amount**. Poker routes through the sheet; they do not. |
| 4 | Buy-in deducts exactly | **F** | **The sheet permits a buy-in below the table minimum** (2,000 chips at a 20,000 table). The server then parks you sitting-out and nothing explains why the hand never starts. |
| 6 | One bet per round | **F** | Baccarat / San Zhang / Cowboy & Beauty: the "Staked T500" label is still a live button. Tapping it with a smaller chip selected **silently reduces the stake** — the server replaces rather than adds. |
| 8 | Settlement + rake | **P** | Verified on the ledger: 5000.000000 -> 4960.000000 + 39.860000 locked = 4999.860000. The 0.14 is rake, nothing else moved. |
| 9 | Leave returns chips | **P** | Verified. |
| 10 | Rejoin | **P** | Verified. |
| 11 | Reconnect banner | **P** | Verified on a real network drop. |

Also on the felts, found by audit. **Niu Niu misstating the stake in both
directions is FIXED** (29 Aug) — the button read "Stake T500 (T100 x 5)" before
the bet and "Staked T100" after, the same bet stated two ways. It now reads
"Stake $500 - 5x on the result": the amount committed, with the multiplier
named as what it is, something that scales SETTLEMENT rather than the stake.
Still open: **Slots renders an invented CHERRY-BELL-STAR line** to any spectator
as though it had been rolled. The dev Felt gallery cannot settle that one — every
figure in it is fixture data — so it needs a real table.

---

## 10. Live-Table Features

| # | Line | Status | Note |
|---|---|---|---|
| 1 | Text chat | **P** poker / **F** all others | `BaseLiveRoom` handles `sit`/`stand`/`buyIn`/`act` and **silently ignores `chat`**. The other eight games accept typing and discard it. Fix written on `feat/chat-all-tables--samuel`. |
| 2-4 | Voice notes | **F** | Recorder and player are built and **imported nowhere**. No mic button exists. `voice` is also a poker-only command, so it needs the same server fix. |
| 5 | Mute covers voice too | **?** | Untestable until voice is wired. |
| 7 | Insurance prompt | **F** | `InsurancePrompt` is complete and **mounted nowhere**. The web mounts it but deliberately passes `quote={null}`, so **no client anywhere can act on an insurance offer** — and there is no accept command in the protocol. |
| 11 | Round is verifiable | **P** | **All six checks pass on device.** `expo-crypto`'s native SHA-256 is byte-identical to the server's — the local check stubs it with Node crypto and cannot prove this. |

---

## 11. Social & Meta

| # | Line | Status | Note |
|---|---|---|---|
| 2-3 | League private tables | **F** | Mobile has no league context. A member can join a league and then **never see, enter, or create a league table** — the membership buys nothing. |
| 6 | Fairness verification | **P** | See above. |
| 7 | Referral link | **F** | See section 1, line 7 — nothing attributes a referral. |

---

## 12. Cross-Cutting

| # | Line | Status | Note |
|---|---|---|---|
| 1 | Never an invented figure | **P** | Four instances fixed: a funded player told "you have T0" at buy-in, T0 on a withdrawal form while loading, an unreadable voice clip passing its own size check, and `money()` printing `TNaN`. |
| 3 | Network errors | **P** | Error boundary added — there was **none in the entire app**, so one null field crashed it outright in release. |

---

## 14. Native app

| # | Line | Status | Note |
|---|---|---|---|
| 1 | Installs and launches | **P** | Android dev client. |
| 3 | Root/jailbreak detection | **?** | **The acceptance criterion for task 8, still untested.** Needs a clean device (expect no banner) and an emulator (expect a warning). Both directions matter. |
| 5-6 | Voice on device | **B** | Blocked by the missing mic button. |
| 7 | Points at the real gateway | **P** | Verified — money reached the real backend and settled. |
| 10 | Under 100MB, store-ready | **F** | **No privacy policy exists anywhere in the repo.** Both stores hard-require one for an app with accounts, money and a microphone. Gambling licensing is a separate blocker. |

---

## The three most expensive things on this list

1. **No deployed gateway.** Blocks all of section 1, all of iOS, and store review.
2. **Chat and voice exist only in poker rooms.** Eight games silently discard chat.
3. **No privacy policy or gambling licence.** Neither store will accept a submission.
4. **No SMTP account.** Added 26 Aug 2026. Now blocks sign-up itself, not just
   receipts: email confirmation is mandatory and fails closed in production, so
   **nobody can create an account on a deployed build until the mailbox
   exists.** One Hostinger mailbox and five environment variables.

None of the four is a code fix, and all four need an owner.