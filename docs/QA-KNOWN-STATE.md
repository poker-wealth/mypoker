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

Re-verified 26 Aug 2026 **in a browser**, against a full local stack: gateway +
financial-core on a shared in-memory MongoDB, with a throwaway SMTP server
capturing every message. 78 checks, all passing — 59 flow checks plus 19 that
need a real clock (the resend cooldown elapsing, a stale sign-up returning).

**Sign-up is now two steps.** `POST /auth/signup` creates the account and mails
a six-digit code but returns **no token**; only `POST /auth/verify-otp` mints a
session. An unconfirmed account cannot hold a session at all, so it can never
reach a money route — the control is the absence of a token, not a flag some
later call has to remember to check.

| # | Line | Status | Note |
|---|---|---|---|
| 1 | Email sign-up | **P** | Verified in a browser. Returns `{ pending, expiresAt, resendAvailableAt }` and never a token; the code is never in the response body. A real message was captured over SMTP: correct sender, subject carrying the code, both text and HTML parts. |
| 2 | Confirmation code | **P** | New. Correct code → session. Wrong code → 400. Six digits, ten-minute expiry, five guesses, five sends per challenge, sixty-second resend cooldown. A spent code cannot be spent twice. |
| 3 | Email login | **P** | Verified in a browser, including a mixed-case address. |
| 4 | Wrong password rejected clearly | **P** | Confirmed still true: 401 "invalid email or password", not "session expired". A wrong password on an *unconfirmed* account is also a flat 401 — confirmation state is only disclosed once the right password has been supplied. |
| 5 | Google sign-in | **B** | Still waiting on client IDs. **But the server-side fix is NOT unmerged — it is on `origin/main`** and confirmed live: an unconfigured gateway answers 503 "Google sign-in is not configured" and never calls out to Google. See TRAPS §6, which has been corrected. |
| 6 | Phone sign-up | **F → closed deliberately** | Refused with `email_required`. It used to be accepted, and with confirmation mandatory it would create an account no code could ever reach — there is no SMS provider. Phone sign-*in* still works for accounts that predate this. |
| 7 | Real display name, not playerId | **P** | Verified through both the confirm response and `/auth/me`. |
| 8 | Session persists | **P** | Verified. |
| 9 | Expiry returns to Login | **P** | Verified: no token → 401, forged signature → 401. |
| 10 | CORS | **P** | The dev origin passes preflight; an unknown origin is not echoed. Browser-only behaviour, so it had not been exercised before. |

**Not verified, and needs a person:** nobody has clicked through the rendered
screens. There is no browser driver and no DOM test harness in this repo
(vitest runs pure logic only, no jsdom, no testing-library), so every check
above drives the same HTTP the browser drives — which covers the server
completely and the React state machine not at all. `npm run dev` with
`VITE_API_URL` pointed at a gateway running this branch is the remaining step.

**Still blocked on the owner: there is no SMTP account.** `financial-core/.env`
has no `SMTP_HOST`/`USER`/`PASS`, so no confirmation code has ever reached a
real inbox — everything above ran against a local capture. That is enough to
prove the message nodemailer builds is correct, and not enough to prove
Hostinger accepts it or that it survives a spam filter. **SAMUEL_V2 task 1
("email notifications — verify it actually works") is still open for the same
reason**, and both unblock together the moment the mailbox exists.

Until then the gateway **fails closed in production**: no SMTP means sign-up is
refused with a 503, never allowed through unconfirmed. Outside production, with
`DEV_AUTH_BYPASS` already on, the code is written to the server console instead
— and to the console only, never to the HTTP response.

---

## 5. Profile / My Account

| # | Line | Status | Note |
|---|---|---|---|
| 3 | Personal Info | **F** | No such screen on mobile. Web has it. |
| 8 | Support | **F** | **Absent from the entire mobile app** — no row, no URL config. A player with a money problem has no path to a human. |

---

## 7. Withdraw

| # | Line | Status | Note |
|---|---|---|---|
| 3 | Invalid address rejected | **P** | Server checksum-validates. |
| 5 | Request withdrawal | **?** | Untested end to end. Double-tap now guarded — two taps in one frame previously filed **two** withdrawal requests; the ledger idempotency key never saw that race. |
| 6 | Over-balance rejected | **P** | Server 409. Client previously reported every 400 as "invalid TRON address" while the user looked at an amount field. Fixed. |

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

Also on the felts, found by audit and not yet fixed: **Niu Niu misstates the
stake in both directions** (button says "Stake T500" when T100 is staked and up
to T3,000 is at risk), and **Slots renders an invented CHERRY-BELL-STAR line**
to any spectator as though it had been rolled.

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