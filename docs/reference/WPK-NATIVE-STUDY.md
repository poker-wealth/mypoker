# WPK native app — functionality study

**Author:** Esther. **Status: WORKSHEET — fill as you walk the app.**

Companion to Samuel's `REFERENCE-STUDY-WPK.md`, which covers 31 screens of the
**H5 web build** (`h5.wpk.com` in Chrome). This one covers the **native app**,
which nobody has looked at.

**Do not re-walk what Samuel already covered.** The Lobby, Games, Friends and
Career tabs are done. The value here is in §2 and §3 — the four things he could
not reach, and anywhere the native app differs from the web build.

---

## Rules, so the two studies merge cleanly

Samuel's conventions, kept deliberately:

1. **Observed vs inferred.** Write what was *on screen*. Anything you worked out
   rather than read, mark **INFERENCE:** — the way he does. A study that mixes
   the two is not usable by anyone else.
2. **If you did not see it, write "not seen".** Do not fill a gap from memory of
   another app, or from a search. That is exactly how §2.1 of the phase plan went
   wrong: bot-vendor pages described a different product and I wrote it up as
   fact.
3. **Screenshot everything you describe.** A line without a screenshot behind it
   is a claim, not a finding.
4. Shots go in `docs/reference/shots/wpk-native/`, named
   `NN-screen-name.png` in the order you walked them.

### Before you screenshot money screens

You are about to open deposit and withdrawal. Two things:

- **Do not enter real card, bank or wallet credentials.** Walk the flow up to the
  point where it asks, screenshot the form, and stop.
- **Redact before committing.** Deposit addresses, QR codes, account numbers,
  your user ID and any balance you would rather not share — black them out.
  Anything committed here is in the repo permanently and the repo is shared.

---

## 1. Provenance — fill this in first

| | |
|---|---|
| Device and OS | |
| How the app was installed | *(App Store / TestFlight / APK / browser + "trust"?)* |
| App version | *(usually under Me → Settings → About)* |
| Date and time of capture | |
| Account state | *(balance? in a club? verified?)* |
| Language the UI came up in | |

**How it installed is itself a finding** — if iOS made you trust a certificate in
Settings, that confirms the sideload route and settles §4.2 of the phase plan.

---

## 1A. First pass — six screens, and what they settle

Captured from the native app. Observed unless marked **INFERENCE**.

### 1A.1 Private table creation — the most informative screen so far

Two shots: **NLHE** and **6+** (Short Deck). This is the "play with friends"
flow from Samuel's Friends tab, and it exposes the whole table-config model in
one screen.

| Control | NLHE | 6+ (Short Deck) |
|---|---|---|
| Table Properties | Private | Private |
| Blinds | **SB/BB 1/2** | **none — no blind fields at all** |
| Ante | 0, dropdown | **1, and it is the only forced bet** |
| Straddle | toggle, off, would be 4 | not offered |
| Buy-In | 200 | 50 |
| Max Buy-In | No Limit | No Limit |
| Duration | 0.5 h — steps 0.5/1/1.5/2/2.5/3/4/6/8 | same |
| **Table Size** | **8** | **6** |
| Run It Twice after All-in | toggle, off | toggle, off |
| Insurance | toggle, off | toggle, off |
| Advanced Settings | "Expand" — not opened | same |
| Bottom | name field + green **START** | same |

**Four things follow, in order of how much they cost us.**

**a) Seat counts are settled, from the app's own dropdown.** NLHE **8**, Short
Deck **6**. That is authoritative — it is the product telling you what it
spreads, not an observation of one busy table. It matches what Samuel observed
in the lobby, so the two studies agree.

Our position is a mess and neither number is right:
`lobby/game-catalog.ts` says `maxPlayers: 9` for texas, short-deck and omaha;
`live/server.ts` actually seats **6** (Texas, Omaha, from `DEFAULT_ROOM`) and
**8** (Short Deck). So the catalogue and the live tables already disagree with
each other, independently of WPK.

> **Do not "fix" Short Deck to 6 without asking.** Its 8 is Victor's explicit
> instruction and the wide felt artwork has eight chairs drawn on it. WPK says 6.
> That is a real conflict between the owner and the reference, and it is his to
> resolve, not ours.

**b) Short Deck is ANTE-ONLY, and ours is not.** The 6+ screen has **no SB/BB
control whatsoever** — just `Ante: 1`. Ours inherits `smallBlind: 10,
bigBlind: 20` from `DEFAULT_ROOM` and is listed as "Short Deck · $0.10/0.20".

`grep -ri ante game-server/src/games/texas/` returns **nothing**. We have no ante
concept at all, so this is not a config change — the betting engine cannot
currently express how the reference deals its Short Deck. This is the largest
engine gap the screens have turned up.

**c) Tables have a lifespan.** Duration 0.5–8 hours, set at creation. That
explains the cyan countdown on the HHPoker lobby rows (`00:55:36`) — it is time
left on the table, not elapsed time. **We have no concept of a table expiring.**

**d) Two features we do not have, both offered at creation:** **Straddle**
(toggle, with the amount shown), and **Run It Twice after All-in**. Insurance we
do have. `grep -ri runItTwice` returns nothing.

### 1A.1b How you get into a table — the access model

From using the app, not from a screenshot:

> **Every game has a code to enter, or you cannot get in — unless it is public.
> And you choose how many players you want inside.**

So there are exactly two kinds of table, and the creator picks which:

| | Public | Private |
|---|---|---|
| How you enter | Open — pick it off the lobby | **You must have the code** |
| Where it appears | The public lobby | Not listed; the code *is* the address |
| Seats | Creator chooses | Creator chooses |

That matches the **Table Properties: Private** control at the top of the
creation screen, and it explains Samuel's Friends tab, which has a
**"Join Table — join with code"** affordance sitting right next to Create.

**Where we stand.** Two of the three parts already exist and one does not:

- `visibility: z.enum(['public','private'])` — **we have this**, in
  `gateway/player-table-routes.ts`, defaulting to private.
- Creator-chosen seat count — **we have this**, `CreateTableSheet` offers 2–9.
- **A join code — we have nothing.** `grep -ri "joinCode\|inviteCode\|tableCode"`
  across `game-server/src` and `frontend/src` returns nothing at all.

So today a private table is private in the sense that it is *unlisted*, with no
mechanism for the creator to let a specific person in. The code is the missing
half: it is what makes "private" usable rather than merely hidden.

**Open question for the next pass:** the Table Size dropdown showed **8** on
NLHE and **6** on 6+ — but if the creator chooses, those may be the *current
selection* rather than the *maximum*. Open the dropdown and write down the full
range for each format. It matters, because if Short Deck's range tops out at 6,
then our 8 is above what the reference permits at all, which is a stronger
version of the conflict in 1A.1(a).

### 1A.2 A house-banked casino-poker vertical

A **HOLD'EM** category inside Games holds five tiles: Caribbean Hold'em,
Caribbean Stud, 3 Card Poker, Ultimate Texas Hold'em, Texas Hold'em Bonus.

These are **player-versus-house** games, not player-versus-player. Our catalogue
has `texas-cowboy` and `cowboy-beauty` in that family; we have none of these five.
Header carries three currency counters (gold, a purple "P", and a third).

### 1A.3 Texas Cowboy — a betting game with baccarat furniture

Two shots of a live 德州牛仔 table, landscape, and it is much more elaborate than
ours.

- Two hands — 牛仔 (Cowboy) vs 公牛 (Bull) — and you bet on the outcome.
- A **grid of side bets**, each with odds and a live stake count:
  cowboy wins ~2×, bull wins ~2×, either hand flush/straight/straight-flush
  1.66×, winning type high-card-or-pair 2.2×, two pair 3.1×, pair 8×, pair of
  aces 10×, straight/flush, full house 20×, quads/straight-flush/royal 248×.
- Every region carries **"N 局未出"** — *not seen for N rounds*. A cold-streak
  counter on each bet.
- **路单 / 统计** — a **baccarat-style road map**: a bead plate of blue/red/green
  results, a grid recording the hand type each round (一对 pair, 顺子 straight,
  同花 flush, 三条 trips, 葫芦 full house, 两对 two pair), and a big-road panel of
  rings.
- Chip denominations 1 / 10 / 100 / 500 / 2000, with 续投 (repeat bet) and
  清屏 (clear).
- Player avatars and balances ring both sides; a **投注返奖** (betting rebate)
  badge sits top-right — this is Samuel's "Betback", visible in-game.
- A countdown runs the betting window (`13`).

**INFERENCE:** the road map and the "rounds since last seen" counters exist to
make a house-edge game feel trackable. That is a retention device, not a rules
feature, and it is cheap next to building a new game.

### 1A.4 Message Center

Segmented: **Hall · Mini Game · Club · Room · System**. Empty state is a card
illustration plus "No message". Note the segmentation — messages are scoped by
where they came from, including per-**Room**.

### 1A.5 Tournament promo page

The **百万回馈赛** (million-rebate series) — *September total guarantee 8,000,000*,
**every Thursday and Sunday, 8pm**, with a **27-day countdown to the series
ending** and a full schedule table (date · weekday · guaranteed prize, 1,000,000
each). Heavily illustrated night scene with photographic faces composited onto
cartoon bodies.

This cross-confirms Samuel's promo-centre finding from the H5 build, so the two
studies agree on it. What is new is the **shape**: a recurring series with a
published calendar and a per-event guarantee, not a one-off tournament.

### 1A.6 The app runs two visual systems

Worth recording because it changes what "match the reference" means:

- **Utility screens are LIGHT** — near-white, clean, iOS-like, teal-green accent
  on the START button and slider fills. Private-table creation, Message Center,
  the casino category grid.
- **Game and promo screens are DARK and heavily illustrated** — the felt, the
  tournament page, the club lobby from the HHPoker shots.

So "dark app" is wrong as a blanket rule. Config is light; play is dark.

### What this pass did NOT cover

Wallet → Management, the inside of a club, the buy-in sheet for a *public*
table, a seated hand with the action bar visible, splash, login. Those remain
the priorities below.

---

## 2. Priority one — the four things Samuel could not reach

These are the open questions in his §9. Each one changes a decision.

### 2.1 Wallet → Management  ⭐ *the single most valuable screen*

**Why it matters:** it settles whether money is direct player-to-platform or
routed through an agent. The whole money section of the phase plan hangs on it.

Record:

- [ ] What is on the Management screen — list every row and button
- [ ] **Deposit:** what methods? (crypto / bank / card / third-party?) If crypto,
      which chains and which coins?
- [ ] Does any part of the deposit flow mention an **agent, club, or another
      person** — or is it player-to-platform throughout?
- [ ] Minimum / maximum amounts, and any fee shown
- [ ] **Withdraw:** same questions. Any KYC, ID check or verification demanded?
- [ ] Any limits, cooling-off, or "contact support" dead end?
- [ ] Where the four currencies (Diamond / Gold / USD / Points) can be converted
      between, if at all — and in which directions
- [ ] Is there a transaction history? What does one row show?

**Then answer in one sentence:** does WPK move real money inside the app, yes or
no? Everything else in this section is detail.

### 2.2 Inside a club

**Why it matters:** we are being asked to build clubs, and nobody has seen one.

- [ ] How you get in — create, join by code, apply, invite?
- [ ] What the club screen shows: members, roles, chips, tables, history?
- [ ] **Are there roles?** Owner / admin / member / anything agent-shaped?
- [ ] Do club tables use the **same wallet** as the lobby, or a separate
      club-scoped balance?
- [ ] Who creates a club table, and what can they set?
- [ ] Anything about commission, rake share, or paying someone?
- [ ] Is there a member approval queue?

### 2.3 The buy-in / seat sheet  ⭐ *settles a live argument*

**Why it matters:** we currently disagree about seat counts, and this answers it
from the reference rather than from opinion.

- [ ] Sit down at a table. Screenshot the buy-in sheet.
- [ ] Min and max buy-in, and how they relate to the blinds
- [ ] Is there a slider, presets, or free entry?
- [ ] **Seat count for each format** — NLHE, Short Deck, PLO. Count the chairs.
- [ ] What happens if you try to buy in below the minimum? *(ours silently parks
      the player sitting out — worth knowing what they do)*
- [ ] Auto-rebuy / auto-top-up option?
- [ ] Anything about insurance or straddle at the point of sitting

### 2.4 A seated table — the felt itself  ⭐ *blocks our largest phase*

Samuel saw a table as an **observer**. Nobody has seen it as a **player**, and
the action bar only exists for a seated player.

- [ ] **The action bar.** Screenshot it. What buttons, in what order, at what
      size? Fold / Check / Call / Raise — and what raise shortcuts (pot fractions?
      a slider? preset chips?)
- [ ] **Pre-action checkboxes** — "check/fold", "call any"? Where do they sit?
- [ ] What the timer looks like when it is *your* turn vs someone else's
- [ ] **Time bank** — does it exist? Manual button or automatic? What does it look
      like when running?
- [ ] What happens on a win: chips animate? sound? who-won text? Where?
- [ ] Showdown: what is revealed, in what order, and for how long?
- [ ] Emotes, chat, voice — what is on the felt and what is behind a menu?
- [ ] Sit out / stand up / leave — where are they?
- [ ] Does the felt change between NLHE, Short Deck and PLO, or is it one felt?

---

## 3. Priority two — native vs H5

Samuel's whole study is the web build. For each, note **same** or **different**,
and screenshot only the differences.

- [ ] Bottom nav — still Lobby / Games / Friends / Career / Me?
- [ ] Does the app still show a **full-screen interstitial ad** on launch?
- [ ] Is the **sports-betting button** still on the felt?
- [ ] Is the promotions centre still untranslated Chinese in an English UI?
- [ ] Is the mirror-domain row still in the wallet?
- [ ] Do the same eight lobby categories appear?
- [ ] Anything in the native app that has **no web equivalent at all** —
      push notifications, biometric login, native share, haptics?

---

## 4. Priority three — only if there is time

- [ ] Splash and loading sequence *(named in our brief, and unseen)*
- [ ] Sign-up from scratch: what is asked for, is email confirmation required,
      is there any ID check?
- [ ] Settings — what is configurable?
- [ ] Sound and haptics — what has audio, and is there a master toggle?
- [ ] Empty states — a category with no tables, an empty wallet, no club
- [ ] Error states — lose connection mid-hand and screenshot what happens ⭐
      *(reconnect behaviour is on our hardening list and nobody knows what good
      looks like)*

---

## 5. What you conclude

Fill this last, after walking it. Three sentences each, no more.

**Does WPK move real money in-app?**

**What is a club actually for, in this product?**

**What does the native app do that the web build does not?**

**What did you see that we have no equivalent of?**

**What did you see that we already do better?**

---

## 6. Open after this pass

List what you still could not reach and why — locked behind a balance, behind a
club invitation, behind KYC, region-gated. Being explicit about the edge of the
study is what makes the rest of it trustworthy.
