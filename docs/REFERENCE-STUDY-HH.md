# HHPoker / AA Poker — first-hand reference study (UI)

Author: Samuel. Recorded 3 Sep 2026 from screenshots taken by Victor.
Companion to `REFERENCE-STUDY-WPK.md` (functionality). HH is the **UI**
reference in the brief, and until now nothing had been captured from it at all.

---

## Provenance

- **Native Android app**, not the web build. Captured 18:25–18:26, battery
  4–8%, so this was a quick pass.
- Account `sam121094`, ID `109 445 065 16`, VIP.0, all balances zero, in no
  club.
- 7 screens: Quick Game, Me, Messages, Discover (lobby), Club, Sign up,
  Verification.
- Observed unless marked **INFERENCE**.
- **Branding note:** the app brands itself **AA POKER** with an "AA" monogram,
  and its own hero banner reads "official HH Poker link". Treat AA Poker and
  HHPoker as the same product.

---

## 1. The visual system — this is the brief

HH is **dark, gold-on-black, premium-casino**. It is the opposite of WPK's
light mint-and-white utility styling, and unlike WPK's native app it is dark
**throughout**, including the utility screens (Me, Messages, Club, Sign up).

| Token | Value (eyeballed) |
|---|---|
| Ground | near-black, ~`#0C0C0C`; the Quick Game screen uses a deep navy ~`#14243F` with a subtle damask/paisley texture |
| Primary accent | **gold / tan**, ~`#D9B87C` — text, icons, borders, active nav |
| Secondary accent | **copper-orange** outline, ~`#C87A3A`, used on button borders |
| Cards | charcoal ~`#1A1A1A`, radius ~14–16px |
| Tournament cards | dark teal-green gradient |
| Player card | blue gradient with a large translucent spade watermark |
| Type | light-weight sans, generous letter-spacing, cream on black; screen titles centred in the top bar |
| Icons | thin gold line-art, consistent weight |

**Button grammar**, two levels:
- **Primary** — gold gradient fill, dark text (CREATE / JOIN, Register, Watch)
- **Secondary** — dark fill with a copper-orange outline (Join Game)

**One oddity worth noticing:** the Create Game button is not a rectangle or a
pill — it is an organic **peanut/cloud silhouette** with a copper outline. HH
is willing to break the shape language for the one button it wants pressed.

**Empty states** are a huge, very low-contrast outlined glyph (a spade) over a
two-line message: *"You don't have any Clubs yet / Join one or create one!"*

**Bottom nav**: five items — **Discover · Club · [AA monogram] · Messages ·
Me** — with the centre replaced by an oversized gold brand mark rather than a
tab label.

## 2. Discover — the lobby

- Hero banner: "official HH Poker link" over a dark starfield, with a gold
  **"View details by clicking"** pill. **INFERENCE:** this is the mirror-domain
  announcement, the same function as WPK's in-wallet URL row.
- Two large gold buttons, side by side, above everything else:
  **CREATE** (cards icon) and **JOIN** (dice icon).
- **"My Games"** row with a **Public Table** pill, a list/grid view toggle, and
  an **"Available seats"** filter pill on the right.
- Game-type chips: **All · NLHE · 🔥CrazyClown · 🔥Cowboy · 🔥SD · Omaha ·
  POFC · Caribbean · Tournament**
- A separate **"Hot:"** row calling out **CrazyClown · SD · AOF · Voiceprint**.

Notes:
- **POFC** = Pineapple Open-Face Chinese. This supports (does not confirm) the
  inference that WPK's "Jack Fruit" is the same family.
- **Voiceprint** is a game type, promoted as hot. Unidentified.
  **INFERENCE:** voice-based, which would be adjacent to the voice feature we
  already have in poker rooms.
- **"Available seats"** is a first-class lobby filter. WPK has no equivalent;
  it solves the same dead-row problem from the other end.

### Tournament card anatomy

Dark teal-green gradient card:

```
🏆  Midnight Turbo-8 Max                      (R) (HT)
    MTT  🕐 17:00 08-31   👥 500   ♠ 100      [ Watch ]
    ⌄
```

- name carries the format — **"-8 Max"**
- `MTT` type tag, start time **with date**, max field 500, buy-in 100
- **(R)** and **(HT)** badges — unidentified. **INFERENCE:** R = re-entry,
  HT = hyper-turbo.
- The action button is **state-dependent**: `Watch` on the already-started
  event, `Register` on the upcoming ones.
- A chevron expands the card in place.

## 3. Quick Game — the join-code model, confirmed

A whole screen dedicated to it:

> **"Enter game PIN to join."** — a cream input field, then a **Join Game**
> button, disabled until the field is filled.
>
> **"Start a game and invite friends!"** — then **Create Game**.

**Both references have a join code.** WPK calls it "Join with code", HH calls
it a **game PIN** and gives it a top-level screen. We have nothing — a private
table today is merely unlisted. This is now well-evidenced rather than a
single observation.

## 4. Club

A **top-level tab**, unlike WPK where clubs sit inside Friends.

Two sub-tabs — **Joined** and **Created** — plus a **+** in the top right. So a
player both joins and creates clubs, and the app distinguishes the two
relationships. Empty state as described above.

## 5. Me

- **Player card**: blue gradient, translucent spade, circular avatar with a
  green ring, nickname, a **VIP.0** chip, a help "?", and **"Blue Card"** on
  the right. A **V0 → V1** progress bar sits under the name.
  **INFERENCE:** Blue Card is a tier name and the bar is progress to VIP 1.
- **ID rendered in grouped digits** — `ID 109 445 065 16` — large and spaced,
  clearly meant to be read aloud or copied.
- **Store** row with **three** currencies: diamond (cyan), gold coin, and a
  green coin. WPK had four (Diamond / Gold / USD / Points).
- 3×3 icon grid: **Items · My friends · Hands Histories / Edit Alias ·
  Settings · Feedback / Results · Invite friends · Theme**

Two of those are worth flagging: **Theme** is a user-selectable app theme, and
**Results** plus **Hands Histories** are HH's equivalent of WPK's Career
tracker — split into two entries rather than one tab.

## 6. Messages

Title reads **"Messages(20)"**, left-aligned rather than centred.
Four segments with outlined gold icons: **System message** (badge 20) ·
**Tournament** · **Prizes** · **Interactions**.

Rows seen: **Buy-in requirement · ALC requests · Diamond Recovery Request**.
"ALC" is unidentified. **Diamond Recovery Request** implies diamonds can be
reclaimed after some failure, which suggests a support-mediated correction path.

Esther recorded WPK's message centre as Hall / Mini Game / Club / Room /
System. **Both references segment messages by source**; the segments differ.

## 7. Sign-up — the most directly actionable screen

Two screens, captured mid-transition.

**Sign up**: a **Phone register / email** tab pair (email active), then
- email field
- password field
- **Invitation code** field
- promo copy: register and top up 4,000 diamonds using an invitation code, and
  **both the new user and the inviter receive diamonds**
- "By signing up, you agree to…"

**Verification**: `✉ samuelmajasan6@gmail`, a **6-character** code field, *"
Verification code has been sent to the email."*, and **"Resend in 58s"**.

Three things follow:

1. **HH's sign-up is email + password + email OTP.** That is precisely the flow
   built in PR #59. The reference validates the work rather than contradicting
   it, and the **6-character code with a 60-second resend** is a concrete spec
   to check ours against.
2. **A referral code is collected at sign-up**, with a **two-sided reward gated
   on a top-up threshold**. This is the agent/referral system surfacing as a
   **distribution** mechanism — not as money mediation. It supports the
   conclusion in `MYPOKER-BUILD-PLAN.md` §3.
3. **The absence of an SMTP mailbox is now blocking a flow both references
   treat as the front door.** No deployed build of ours can create an account.

## 8. Where HH and WPK differ

| | WPK | HH |
|---|---|---|
| Palette | light mint / white, dark felt | **dark gold-on-black throughout** |
| Nav | Lobby · Games · Friends · Career · Me | Discover · Club · **AA** · Messages · Me |
| Clubs | inside Friends | **top-level tab**, Joined / Created |
| Join code | "Join with code" affordance | **dedicated Quick Game screen, "game PIN"** |
| Tracker | Career, 7 sub-tabs | split: Results + Hands Histories |
| Currencies | 4 (Diamond/Gold/USD/Points) | 3 (diamond/gold/green) |
| Casino vertical | large and prominent | **not seen in this pass** |

**The brief splits cleanly:** take flow and formats from WPK, take palette,
type, spacing and button grammar from HH. They do not conflict, because they
are answering different questions.

## 9. Not captured

The felt itself (no table screen), the buy-in sheet, inside a club, the wallet
or store interior, any deposit/withdraw screen, splash and loading, and
whatever "CrazyClown", "Voiceprint", "ALC", "(R)" and "(HT)" actually are.

---

## 10. Cowboy — a house-banked betting game (added 4 Sep)

Captured 16:02. This is HH's 德州牛仔 / Cowboy game, reached from the Cowboy
lobby chip. **It is not a poker felt** — it is a betting board — but it is
directly comparable to a game we already ship.

### Visual — game screens are GREEN, not black

This corrects §1's "dark throughout". The **shell** is gold-on-black; the
**game screen** is a rich forest-green felt (~`#3D6B52`) with the same gold
accents, gold hairline borders and cream/gold display type. So HH runs two
grounds: black for chrome and navigation, green felt for play.

Chrome: four circular gold-outlined icon buttons, two per top corner — a
ledger/bills icon and a spade on the left, an ellipsis menu and a players icon
on the right. One full-width gold pill at the bottom: **Join Game** (this is
the pre-join preview state).

### Layout

Two flat-vector characters face each other — **Cowboy** left, **Cowgirl**
right — each holding two red patterned card backs. Between them the board:
one revealed card (`4♣`) plus four face-down backs. A `小额试手` ("small
stakes / trial hand") label sits under it, above a dark pill carrying a **row
of cyan and red dots** — the road-map trail — with a dealing-hand icon at its
left end.

### The bet grid

| Group | Bets and odds |
|---|---|
| Outright | **Cowboy Win 2.02x · Push 19.5x · Cowgirl Win 2.02x** |
| Either hand type | Suited/Connects/Suited connects **1.66x** · Pair **8.5x** · Pair A's **100x** |
| Winning hand rank | High card/One pair **2.2x** · Two pairs **3.1x** · Three of a kind/Straight/Flush **4.5x** · Full House **20x** · Four of a kind/Straight Flush/Royal Flush **248x** |

Every region carries **a trail of orange and grey dots** beneath it — the
recent history of whether that outcome hit — and the rarer ones carry a
cold-streak count: **"7 hands vacant"**, **"31 hands vacant"**,
**"79 hands vacant"**.

That is the English rendering of the `N 局未出` counters Esther recorded on
WPK's Texas Cowboy (`WPK-NATIVE-STUDY.md` §1A.3). **Both references ship the
same game with the same retention furniture**, so this is confirmed across
both rather than observed once.

### Why this one matters to us

We already ship **`cowboy-beauty`** — Cowboy & Beauty, 牛仔美女 — which is
this game. We have the rules; what we do not have is any of the presentation
layer around them:

- a **published odds grid** with a multiplier per bet region
- **per-region result trails** (the dot rows)
- **"N hands vacant"** cold-streak counters
- a **road map** of past results

**INFERENCE:** none of that changes a single outcome. It exists to make a
house-edge game feel trackable and to give a player a reason to sit through
rounds they are not betting. It is cheap next to building a new game, and we
own the game already.

Same reading applies to `texas-cowboy`, which we also ship.

---

## 11. HH's public cash lobby is empty for a clubless account (4 Sep, 16:22)

**Observed.** Account `sam121094` — in no club, all balances zero. In the
**Public Table** listing:

- `NLHE` — no tables
- `SD` — no tables

Earlier the same day, with `All` selected, the same lobby **did** return
tournament cards (Midnight Turbo-8 Max, Golden Diamond Rush-8 Max). So the
lobby is not broken and the account is not blocked from it: what is empty is
specifically the **cash-game categories**.

The Discover hero at the time was advertising a club by name ("Offending
Club"), and `Club` is a top-level tab whose empty state reads "You don't have
any Clubs yet / Join one or create one!"

**INFERENCE — not yet confirmed:** HH's cash tables are **club-scoped**, while
tournaments are platform-wide. Confirming this needs one test: join a club,
then look at the cash categories again.

### Why this matters more than it looks

If it holds, **the two references disagree on the point V3 §1 was arguing
about**, and they disagree in opposite directions:

| | WPK | HH |
|---|---|---|
| Cash tables for a clubless account | **Visible and playable** — a full public lobby of eight categories, Zoom pools carrying 266–274 players | **None** |
| Where clubs sit | inside Friends, secondary | **top-level tab** |
| Tournaments | public | public |

V3 §1 claimed both references were club-and-union products. The WPK study
disproved that **for WPK**. It may well be true **for HH**.

That does not restore §1 — its specific claims about WPK remain wrong, and no
union or agent has appeared in either app. But it does mean **"build it like
the references" has no single answer on lobby structure**, and the choice
between a public cash lobby (WPK) and club-scoped cash tables (HH) is a
product decision someone has to make deliberately rather than inherit.

Since the brief assigns **functionality to WPK** and **UI to HH**, the
defensible reading is: take the **public lobby structure from WPK**, take the
**look from HH**. Worth putting to Victor rather than assuming.

### Alternatives not yet ruled out

Time of day (16:22 local), region gating, or a stake/currency filter left
active behind the floating filter control. The club test settles it fastest.

---

## 12. Tournament listing, second pass (4 Sep, 17:07)

`Tournament` chip selected. All four cards read **Register** and all are dated
**09-05** — the day's events had finished, so no `Watch` was available.

| Event | Time | Field | Buy-in | Badges |
|---|---|---|---|---|
| Midnight Turbo-**8 Max** | 17:00 09-05 | 500 | 100 gold | R · HT |
| Blitz Weekend Special | 12:00 09-05 | 1000 | 500 gold | R · HT |
| Golden Diamond Rush-**8 Max** | 11:00 09-05 | 500 | 100 gold | R · HT |
| **Diamond Bomb Pot-9 Max** | 10:00 09-05 | 500 | **💎 50 diamond** | R |

Three additions to §2:

1. **HH runs 9-max as well as 8-max.** "Diamond Bomb Pot-**9 Max**". Relevant
   to the open seat-count decision: the reference is not uniformly 8.
2. **Tournaments are denominated in two currencies** — gold for most, diamond
   for the Bomb Pot event.
3. **Bomb Pot exists as a tournament format**, not only as the cash variant
   seen in WPK's lobby ("Bomb SD").

The `Watch` button seen on 3 Sep confirms observing a running event is
possible; it simply requires one to be in progress.

---

## 13. "Create a game" — and it contradicts WPK (4 Sep, 17:17)

The counterpart to `WPK-NATIVE-STUDY.md` §1A.1, and the two references **do not
agree**.

**Ground:** this screen is **dark navy** (~`#132A45`), not the shell's black and
not the felt's green. HH runs three grounds — black chrome, navy config, green
play. Slider thumbs are rendered as red-and-white **poker chips**.

### Game type — a 7-tile grid, two of them locked

`NLHE` (selected) · `SNG` · `Short Deck` · `Omaha` · `POFC` ·
`Caribbean` 🔒 · `Cowboy` 🔒

Caribbean and Cowboy carry a **padlock in the corner** — gated, by what is not
stated. **SNG is creatable privately**, which WPK did not offer.

### Controls, in order

| Control | Value / range |
|---|---|
| Game name | free text |
| Small Blind / Big Blind | **1/2**, on a slider at its lowest stop |
| Buy-in | **200** |
| **Players** | **slider 2–9, set to 9** |
| **Auto-start players count** | None · 2 · 3 · 5 · 7 · 9 — set to None |
| **Ante** | 0 · 1 · 2 · 4 · 8 · 16 · 20 · 30 — set to 0 |

Footer: **Balance 💎 0 · Cost 💎 0**, and a **Start now** button.

### Four findings

**1. Seat counts are NOT settled, and the earlier conclusion must be withdrawn.**
`WPK-NATIVE-STUDY.md` §1A.1(a) reads: *"Seat counts are settled, from the app's
own dropdown. NLHE 8, Short Deck 6. That is authoritative."* That is
authoritative **for WPK**. HH's own slider runs **2–9 and sits at 9** for NLHE.

| | Our catalogue | Our live rooms | WPK | HH |
|---|---|---|---|---|
| NLHE | 9 | 6 | **8** | **9** |

**Our catalogue's 9 matches HH.** The references disagree, so "the reference
says N" is no longer an argument either way — this is now purely Victor's
product call, and the case for changing anything is weaker than it looked.

**2. Ante is offered on NLHE, alongside blinds.** WPK showed ante as the *only*
forced bet on Short Deck. HH offers `1/2` blinds **and** an ante ladder up to 30
on Hold'em. So ante is not a Short-Deck special case — it is a general
forced-bet the engine needs. We have none (`grep -ri ante
game-server/src/games/texas/` → nothing). This strengthens the case for it
being Esther's first piece of engine work.

**3. "Auto-start players count" — a mechanism we do not have.** A created table
sits idle until N players are seated, then starts itself. Options None/2/3/5/7/9.
This is directly aimed at the empty-table problem: the creator declares the
quorum rather than everyone staring at an empty felt deciding whether to sit.
Cheap, and worth stealing.

**4. Creating a table is free.** Balance 💎 0, **Cost 💎 0**. No top-up gate on
private-game creation, at least at these settings.

### Not yet captured

Whatever sits below `Ante` — WPK's equivalent screen carried Straddle, Max
Buy-In, Duration, Table Size, Run It Twice, Insurance, Table Properties
(public/private) and an "Advanced Settings" expander. Scrolling this form is the
next shot.

---

## 14. The felt, the buy-in sheet, and the full create form (4 Sep, 17:27)

The largest single haul so far. A private NLHE table was created and entered;
sitting down was blocked on balance, which is itself a finding.

### 14.1 The poker felt — a FOURTH ground colour

**Deep maroon / burgundy**, textured, with a radial vignette. Not the shell's
black, not the config screen's navy, not the Cowboy game's green.

HH therefore runs four grounds:

| Surface | Ground |
|---|---|
| Shell (nav, Me, Messages, Club, Discover) | near-black |
| Create-a-game config | dark navy `~#132A45` |
| Casino games (Cowboy) | forest green |
| **Poker felt** | **maroon / burgundy** |

Any claim that HH is "dark gold-on-black" is only true of the chrome. §1 is
corrected accordingly.

### 14.2 Felt layout

- **Nine seats**, drawn as **dashed circles**. Label is state-dependent:
  **"Empty"** while the table is not joinable, **"Take the seat"** once it is.
  Arrangement: 2 top · 2 upper-side · 2 mid-side · 2 lower-side · 1 bottom.
- A large low-contrast **AA POKER** wordmark watermarks the centre.
- Centre text block, stacked and small:

```
* test *
#113550918-0
Invitation code: 272490
Blinds 1/2
www.hhpoker777.com
www.hpoker666.com
```

  — **the invitation code is printed on the felt itself**, next to the table
  id and stakes. Two mirror domains are printed under it.
- Idle state shows two gold pills mid-table: **Start** and **Share**.
- Own avatar sits bottom-centre with the stack (`0`) beneath it.
- Bottom chrome, four controls: a records/list icon · a spade in a circle ·
  **a microphone** · an ellipsis in a circle. Hamburger top-left.
- A floating **"Pray Wealth"** (招财) god-of-wealth badge sits bottom-left.
- Status line at the very bottom: **"wait for next"**.

**The join code is not a hidden field — it is table furniture.** Whatever we
build for §6 of the work split should put it on the felt, not behind a menu.

### 14.3 Buy-in sheet

Dark sheet over the felt:

- title (`test`) and a close X
- **Small Blind/Big Blind `1/2`** · **Buyin `200`**
- a **Min ——— Max slider**, thumb at Min
- **Total coins: 🪙 0**
- **Fee: 🪙 20**
- gold **Join Game** pill

**Sitting down costs a fee (20 coins) on top of the buy-in.** With a zero
balance the attempt returned an iOS-style alert:

> **Tips** — "Not enough Gems. Please purchase in the Store"  ·  Cancel /
> **Purchase**

Note the currency mismatch in their own copy: the sheet quotes coins, the error
says Gems.

### 14.4 The full create form — every control

Above the fold (§13) plus, below it:

| Control | Range | Default |
|---|---|---|
| **Game length** | 1 · 1.5 · 2 · 2.5 · 3 · 4 · 5 · 6 (hours) | 1 |
| **Buy-in amount (100BB)** | 0.5 → 8, as a **two-thumb range** | 1 – 4 |
| **Min. holding chips** | 0.5 → 4 | 1 |
| **Minimum VPIP requirement** (%, 300+ hands) | 0 · 25 · 30 · 35 · 40 · 45 | 0 |
| **Service fee (%)** | 0 · 0.5 · 1 · 1.5 · 2 · 2.5 · 3 · 4 · 5 | 0 |

Toggles, all off by default:

`Restricting onlookers` (disabled) · **`iOS Only`** · **`Straddle`** ·
`Require buy-in confirmation` · `Insurance mode` ·
**`Ban same GPS point players`** · **`Ban same IP players`** ·
**`All-in or Fold`** · **`Hide Hole-cards`** *("The hole cards are hidden to a
player pre-flop until it's his/her turn to act.")* · `Cash out chips`

### 14.5 What this changes for us

**Confirmed for the third time, across both references:** ante, straddle, table
duration, join code. These are no longer arguable.

**New, and worth taking:**

1. **The creator sets the rake.** `Service fee (%)`, 0–5, chosen per table. Our
   rake is fixed in room config (`rakeBps: 500` per game). A host-set fee is a
   different model and it is what makes club/private games viable for a host.
2. **Buy-in is a range, quoted in 100BB units**, not a single number. Ours is
   `minBuyIn`/`maxBuyIn` in chips. Theirs is expressed in big blinds, which is
   how players actually think.
3. **`Min. holding chips`** — a floor on your stack, enforced. This is the
   correct fix for our known bug where a below-minimum buy-in silently parks
   the player sitting out with no explanation.
4. **`Minimum VPIP requirement (300+ hands)`** — a *style* gate on who may sit.
   Exclude nits from a loose game. We already compute VPIP
   (`game-server/src/players/anti-bot.ts`, `frontend/src/api/stats.ts`) but
   only for bot detection, never as a table-entry condition. The data exists.
5. **`Ban same IP` / `Ban same GPS point`** — collusion prevention as a *table
   setting the host chooses*. We have collusion **detection** (`agents/`,
   `league/`) but nothing a host can switch on at creation. Different thing.
6. **`Hide Hole-cards`** until it is your turn — an anti-ghosting measure with a
   clear in-app explanation. Cheap, and it pairs with the above.
7. **`All-in or Fold` is a toggle, not a game type.** WPK ships AOF as its own
   lobby category. HH makes it a checkbox on any table. Ours would be a flag on
   the betting engine — cheaper than a category.
8. **`Auto-start players count`** (§13) plus **`Require buy-in confirmation`**
   plus **`Cash out chips`** — three small host controls we have none of.
9. **`iOS Only`** — a platform filter on a table. Noted, not recommended.

**Still not captured:** a seated table with the action bar. That needs a
balance, and the store gate blocks it. Watching a live tournament tomorrow
remains the route.
