# MYPOKER — work split, Samuel and Esther

Drafted by Samuel, 4 Sep 2026.

**Status: proposal.** Operating Guide v3.0 sequences this — Esther writes the
phase breakdown, then "divide the phases between yourselves and say clearly who
has taken what." This is a seam for her to phase against, not a split either of
us is claiming. Once she has agreed it, we both tell Victor who took what.

Sources: `REFERENCE-STUDY-WPK.md`, `REFERENCE-STUDY-HH.md`,
`MYPOKER-BUILD-PLAN.md`, and Esther's `WPK-NATIVE-STUDY.md`.

---

## The seam

**Esther owns everything inside a hand. Samuel owns everything that gets a
player to a hand, and everything that happens to their money.**

Every gap either study has turned up falls cleanly on one side. It also
satisfies the Guide's "you test each other's work, not your own" — each column
ends up as a coherent surface the other person can sit down and exercise.

---

## Esther — strict order

Per the Guide her assigned job this week is the study and the breakdown, **not
code**. Nothing in items 4–6 starts until item 2 is delivered.

### 1. Capture four missing reference screens

- **HH: the felt / a seated table.** We have **zero** HH table shots. Victor
  names "the game board" as a phase and HH is the UI reference for it.
- **HH: the buy-in sheet.**
- **WPK: the buy-in sheet** — her worksheet §2.3.
- **WPK: seated table + action bar** — her worksheet §2.4. Neither reference
  has been seen as a *seated player*, only as an observer, and the action bar
  only exists for a seated player.

First because the breakdown cannot phase the game board without them, and it is
half a day's work.

### 2. Write the phase breakdown

The artifact everything else waits on. To the Guide's standard: screen by
screen in Victor's idiom — home page UI, splash screen, loading screen, login
page, the game board, each individual game — written so any developer can pick
a phase up without asking her what it means.

All inputs now exist. It was genuinely blocked on HH captures until 3 Sep; it
is not blocked any more.



### 4. Ante in the betting engine

First of the code. `grep -ri ante game-server/src/games/texas/` returns
nothing, so this is **not a config change** — the engine cannot express a
blind-less Short Deck at all, and WPK's Short Deck has no SB/BB control
whatsoever. Blocks Short Deck parity. Depends on nobody.

### 5. Straddle

Straight after ante — same forced-bet path, cheaper done together than apart.
Enables the "Loose" table format seen in WPK's lobby.

### 6. Table duration / expiry

Set at creation, 0.5–8h in the reference. Also explains HH's cyan lobby
countdown, which is time remaining rather than elapsed.

### Later, in her column

Run It Twice · bomb pot · AOF · splash · the felt and game boards re-skinned
to HH.

### Blocked — do not start

| Item | Blocked on |
|---|---|
| Seat counts | **Victor.** Three numbers already disagree — catalogue 9, `DEFAULT_ROOM` 6, Short Deck 8. His 8 plus the eight-chair felt art against WPK's 6 is owner-vs-reference, not engineering. |
| The felt re-skin | The HH felt shot (item 1) · Samuel's design tokens · Olivia's art |
| Tournaments | Both of our first phases |

---

## Samuel — strict order

### 1. Post the PR #59 reply

Written at `Poker/pr59-reply.md`, never posted — `gh` is not installed on this
machine, so it goes in by hand. Victor's review is waiting on it.

### 2. Design tokens — HH palette, type, button grammar

First of the code, because **both columns consume them** and doing it twice is
waste. From `REFERENCE-STUDY-HH.md` §1: near-black ground, gold/tan `#D9B87C`
accent, copper-orange `#C87A3A` outlines, charcoal cards ~14–16px radius, thin
gold line icons, light-weight sans. Two button levels — gold gradient fill with
dark text, and dark fill with copper outline.

### 3. Capture worksheet §2.1 and §2.2

**Wallet → Management** (deposit/withdraw) and **inside a club**. §2.1 is the
single screen the whole money section of the build plan hangs on, and after 38
reference screens the agent theory still has no supporting evidence. Cheap, and
it settles a decision.

Needs the app installed on a second device — one person holding the only copy
is a bottleneck and a single point of failure for both studies.

### 4. Clear the auth/admin debt

By the Guide's definition this work is **not done**: the tests pass but nothing
has been exercised against a running server, and "anything touching access,
money or user data is only done when you have tested who can reach it." Also
the honest gap for Victor — every store is mocked, there is no Mongo-backed
harness, so mutating the real `user-store` to reintroduce the account-takeover
leaves the suite green.

### 5. The shell re-skinned to HH

Bottom nav · Discover/lobby · login/sign-up.

**CORRECTION, 7 Sep.** This item used to read "splash and loading do not exist
on any surface today". That was wrong, and it was wrong in the way this project
keeps being wrong — asserted from memory rather than from the files.

Both exist, and both are better than anything I would have written:

- **Web** — an inline boot screen in `frontend/index.html`, deliberately NOT
  React, with a comment explaining why: a React splash cannot remove the white
  flash it exists to hide. It paints on the browser's first frame; `main.tsx`
  dismisses it on a double `requestAnimationFrame`.
- **Native** — `expo-splash-screen`, `preventAutoHideAsync()` at boot, held
  until the fonts resolve.
- **Loading** — `Skeleton` exists and is used across at least eight pages.
  There is no route-level loading screen because the bundle is a single chunk,
  so there is nothing to wait on between routes.

What was actually needed was a repair, not a build: the v3 repalette left all
of them on the old violet brand, so a cold start flashed the previous identity.
Fixed, and `npm run check:splash` now enforces it.

Sign-up has a spec now: HH uses email + password + email OTP, **6-character
code, 60-second resend**, plus an optional invitation code — which is what
PR #59 already built. Check ours against it.

### 6. Join code / game PIN

**Evidenced in both references.** WPK: "Join Table — join with code". HH: a
dedicated Quick Game screen, "Enter game PIN to join", with Join disabled until
filled. We have nothing — `joinCode`/`inviteCode`/`tableCode` return zero hits.
Today a private table is merely *unlisted*, with no way for its creator to let a
named person in.

### 7. Lobby presentation

Available-seats filter (HH) · stake tiers Micro/Low/Mid/High (WPK) · occupancy
ring · MVP avatar per row · HOT badge · live win ticker. Cheap, entirely
presentational, and most of what makes both references feel alive despite long
tails as dead as ours.

### 8. Pooling / fast-fold

The highest-leverage single feature in either study: WPK's two Zoom rows hold
266–274 players while its best PLO table holds 4. Clean seam — fast-fold does
not change how a hand is dealt, only which table you are sent to next, so
Esther's engine is used unchanged.

### Continuous

**Chase SMTP daily.** No deployed build can create an account at all, and both
references treat email sign-up as the front door. With qiqi, via Victor.

---

## Neither column

### Tournaments — split when we get there

The piece too big for one side. Esther: blind schedule, table balancing,
breaks. Samuel: registration, late registration, prize distribution, lobby
rows. Design it during Samuel's item 8, do not start it cold afterwards.

### Olivia — graphics

The Guide gives her **all MYPOKER graphics**. The illustrated felt is a real
part of the reference and needs briefing early, not late. Whoever owns the
surface briefs her for it: **Esther** for felt, table and game art, **Samuel**
for brand and shell iconography.

### Victor — decisions

1. **Seat counts.** His 8 for Short Deck, and the eight-chair felt art, against
   the reference's 6.
2. **The agent system.** Does it stay as a distribution and commission channel
   (referral links, sub-agents, revenue share) with money direct
   player↔platform? Both references collect a referral code at sign-up and
   neither mediates money through an agent.
3. **That the study contradicts V3 §1.** WPK is not a club-and-union agent
   platform. The Guide says where we disagree "we say so and explain why" —
   this needs stating to him, not filing in `docs/`.
4. **The website.** `frontend/` is both the Telegram Mini App *and* the browser
   app. The direction says the website only describes the platform and serves
   downloads, so the job is separating the marketing site from the Mini App —
   and deciding whether the bare-browser path stays as a convenience or closes.

---


## Dependencies at a glance

```
HH felt shot (Esther #1) ─┐
Design tokens (Samuel #2) ─┼─→ felt re-skin (Esther, later)
Olivia's felt art ────────┘

Esther #2 breakdown ─→ formal division of phases ─→ everything

SMTP (Victor/qiqi) ─→ any real account on a deployed build
                   ─→ Samuel #4, #5 tested end to end

Victor's seat-count call ─→ Esther's seat work
```
