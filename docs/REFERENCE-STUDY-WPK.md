# WPK (WePoker) — first-hand reference study

Author: Samuel. Recorded 2 Sep 2026 from screenshots taken by Victor.
**This supersedes §1 of `MYPOKER-DIRECTION-V3.md`**, which was written from web
search and is wrong in its central claim. See §8.

---

## Provenance — read this before quoting anything here

- **Surface: `h5.wpk.com` in Chrome on Android.** This is WPK's **mobile web
  (H5) build**, not the native app. Anything absent here may still exist in the
  native app or be region-gated.
- 31 screens, one logged-in account (no balance, no club), captured across two
  mornings — 09:35–09:36 and 11:06–11:12.
- Everything below described as seen **was on screen**. Anything reasoned from
  what was seen is marked **INFERENCE**.
- Not covered: Wallet → "Management" (deposit/withdraw), the inside of a club,
  the buy-in/seat sheet, and any seated play. Those remain open.

---

## 1. Shell

Bottom nav, five tabs: **Lobby | Games | Friends | Career | Me**.
Lobby is the default. There is no Clubs tab — clubs live inside Friends.

The header is per-tab and shows the balances that tab spends:

| Tab | Balances in header |
|---|---|
| Lobby | Gold + USD($) |
| Games | Gold + Points + tickets |
| Friends | Diamond only |
| Me | Diamond, Gold, USD, Points |

**INFERENCE:** USD is cash, Gold is the everyday soft currency, Diamond is the
club/private-game currency, Points are loyalty and redeemable. "Diamond" also
appears as a filter chip *in the same row as* Micro/Low/Mid/High, so currency
is chosen the way a stake tier is chosen.

Every session opens with a **full-screen interstitial ad** carrying a "2s | ×"
skip timer.

## 2. Lobby — a public, category-driven cash lobby

Eight categories, **user-reorderable** ("Tap to enter category / long-press to
reorder"): **MTT** (Tournament), **NLHE** (Texas Holdem), **AOF** (Allin or
Fold), **Short Deck** (6+), **Splash**, **Spin&Go** (SNG), **PLO** (Omaha),
**Jack Fruit**. A horizontal tab strip with a chevron opens the full grid.

Per category: tier chips **Diamond | Micro | Low | Mid | High** plus a funnel.

**Table row anatomy** — the thing worth copying:

```
NAME + 4-digit id
[currency icon] stakes | buy-in     [seats or n/max ring]     [MVP avatar]
```

- Occupancy is a **ring that fills green**, not a bare number.
- **MVP badge**: the avatar *and nickname* of the table's top winner, on every
  occupied row. A face on a row that would otherwise be a number.
- **HOT** badge on the busiest rows.

### Stake notation

`0.05/0.1 (0.25)` = small blind / big blind / **straddle**.
`0.02/0.05/0.1(0.02)` = three blind levels plus ante.

### Variant prefixes seen

**Zoom** (fast-fold pool), **Loose** (forced straddle), **Bomb** (bomb pot),
**Splash** (splash pot), **AOF** (all-in or fold, fixed 8bb buy-in).

### Seat counts — observed, not assumed

| Format | Seats |
|---|---|
| NLHE cash (incl. Zoom) | **8** |
| Short Deck | **6** |
| PLO | **6** |
| Splash | 6 |
| Jack Fruit | 2 |
| Career positional grid offers | 9 / 8 / 6 |

### Liquidity — the most important observation in this study

WPK does **not** spread players over many tables. It concentrates them:

| Row | Players |
|---|---|
| 8-Max **Zoom** HE 2016 | **266**, then **274** the next day — HOT |
| 8-Max **Zoom** HE 2015 | 136, then 118 — HOT |
| AOF 2001 / 2002 | 4–9 each |
| MTTs (concurrent) | 114, 120, 173, 133, 68, 14 |
| Best PLO table | 4 |
| Short Deck micro | 5/6, 5/6, 2/6, then 0/6, 0/6, 0/6 |
| Jack Fruit (all) | 0/2 |

**Zoom rows show a player count, not `n/max`, because they are pools rather
than tables.** WPK's long tail is as dead as ours. The difference is that two
rows at the top of the busiest category carry 274 people, and the lobby is
tiered so you rarely look at the dead rows.

**There is no union or federation anywhere in this.** Pooling and scheduling
are how WPK fills games.

### MTT

Filters: All | Mega Hour | Series Side | WPT D… A dismissible explainer reads
*"Prize Pool $$$$$ — This indicates MTT with overlay and about to close
registration. Join it now."* — **overlay is advertised as a lure.**

Row = pin + status block (**Late Reg CLOSES IN 32:56** / **Registering STARTS
IN 1h56m**) + coloured title bar + start time + buy-in + entrants + prize pool.

Observed: ¥188 **WPT® MYSTER¥ Millions** (114 entrants, pool 2,500,000) · ¥218
Afternoon Classic (120 / 30,000) · ¥166 Prime Mystery Bounty (173 / 50,000) ·
¥220 Knockout King (133 / 40,000) · ¥188 Asia Main Event (14 / 500,000) ·
**$25 Weekly Golden Bounty (68 / $250,000)**.

Two facts: MTTs run in **both gold(¥) and USD**, and WPK carries **licensed
WPT® branding**.

### AOF

A full-width **JACKPOT Amount 000,336,393** odometer sits above the list.
Buy-in is fixed at **8 big blinds** at every level: 0.5/1→8, 1/2→16, 2/4→32,
5/10→80, 10/20→160, 25/50→400.

### Spin&Go

Six buy-in tiles — $1, $5, $10, $25, $50, $100 — each with an odometer
"WIN UP TO" figure ($12,264 at $1 rising to $805,257 at $100) and a HOW TO PLAY.

### Jack Fruit

Heads-up (0/2), Gold, quoted as **Bring-in 0.1 / Buy-in 20**. Pineapple art.
**INFERENCE:** this is 大菠萝 / Open-Face Chinese. Not confirmed.

"Mushroom" appears as a Career filter chip but has **no lobby category**;
unidentified.

## 3. The table (observer view)

Table `HLB8098`, 8 seats, USD, Blind `$0.02/$0.05/$0.1(0.02)`.

- **The felt is a full illustrated scene** — an underwater one: coral, seaweed,
  fish, a shark, a teal-to-deep-blue depth gradient. Not a green oval. A faint
  "WePoker www.wpk.com" watermark sits in the middle.
- Circular avatars ring an elongated rounded rail; the stack sits in a dark
  pill *below* each avatar.
- **Folded players are desaturated to greyscale with "Fold" over the avatar.**
  Live players keep colour and show red card backs.
- The active player has a **ring timer** reading `11s`.
- The board uses a **four-colour deck** — hearts red, clubs green, diamonds
  blue — on large white rounded cards, rank top-left plus a big pip.
- The pot is shown **twice**: a ribbon reading `$1.07` and a chip-stack graphic
  below it.
- **`JP 503`** — a per-table progressive jackpot counter, top centre.
- A dismissible **marquee ad inside the table**: "…and guessing hand and
  getting 200 times the reward".
- Chrome: hamburger and a **$** button top-left; avatar and deck icon
  top-right; stats icon bottom-left; shield bottom-right.
- **A "SPORT BETTING" football button sits on the felt.**

## 4. Games — a real casino vertical

Gold-denominated, with a live payout ticker ("the dealer paid 9606 gold
coins…"). Tiles carry **live online counts**:

Slots Mega Win **434** (NEW) · Texas Cowboy 163 (Betback) · Poker Master 159
(Betback) · Lucky 6 Baccarat 51 · Casino Hold'em 27 · Beat… · Happy…

"**Betback**" = wagering rebate.

## 5. Friends — clubs and private games

One screen, four affordances:

- **Create** — "Play with friends" (private table)
- **Join Table** — "Join with code"
- **Club >** — "Join and compete with players", with its own **Create** and
  **Join** buttons

**A player creates or joins a club themselves, in two taps.** No agent, no
gatekeeper, no invite broker. Clubs are a secondary social surface; the Lobby
is the product.

## 6. Career — a built-in tracker

Seven sub-tabs: Session, My Hands, Personal, Rival, Position, Chart, Hand,
under a scope dropdown reading "Friends ▾".

- **Hand** — per-starting-hand table: Hand / Win-Total / Win Rate / P&L.
- **Position** — 9-max seat diagram with a 9-Max / 8-Max / 6-Max selector.
- **Rival** — opponent lookup by user ID or nickname, 7 / 30 / 90 days,
  Num or BB.
- **My Hands** — Recent / Favourites. **"Only shows records from the last
  3 days."**
- **Session** — Today / 7 / 30 / 90 Days, P&L and Overall Record, Game History.

Free, native, no third-party HUD required.

## 7. Money and promotion

**Me → Wallet** shows Diamond / Gold / USD($) / Points with a **Redeem**
button, a **Management >** link, a Backpack (Bonus, Tickets/Items), a Rewards
Center, and an **Others → URL** row exposing a mirror domain
(`web.wpk180.com`).

**No deposit or withdraw control was seen.** It is presumably behind
"Management", which was not captured. **This is the one open question that
matters.**

The promotions centre (福利活动中心) is **untranslated Chinese** while the rest
of the UI is English:

- 百万回馈赛 — million-rebate tournament series, September guarantee 8,000,000,
  Thursdays and Sundays 20:00
- 30万现金红包雨 — 300k cash **red-envelope rain**, Mon–Wed daily at 15:00
- 钻石百家乐狂欢周 — **Diamond Baccarat** carnival, 66,666 diamonds on wagers
- 金币狂欢嘉年华 / 钻石狂欢嘉年华 — wagering-rebate carnivals

A **live win ticker** runs across the lobby with real nicknames and amounts.

## 8. What V3 §1 got wrong

§1 asserted WPK is a PPPoker-family club-and-union app in which "play happens
inside clubs", "clubs federate into unions that share one lobby", "agents
mediate money", and "chips are club-scoped, not a platform wallet balance".

Against 31 screens:

| §1 claim | Observed |
|---|---|
| Play happens inside clubs | **No.** Lobby is the default tab and carries the game. |
| Clubs federate into unions | **No union, alliance or federation anywhere.** |
| Agents mediate money | **Zero mentions of agent or commission in 31 screens.** |
| Chips are club-scoped | **No.** A four-currency platform wallet sits on the player's own profile. |
| No player KYC | Not observable. Unresolved. |

The V3 sources were poker-bot vendors and agent brokers, who describe the
PPPoker model and attach WPK's name to it. **WPK is a direct-wallet,
public-lobby, multi-vertical gambling platform** — which is, structurally, what
MYPOKER already is.

## 9. Still to capture

1. **Wallet → Management** — deposit / withdraw. Settles the money model.
2. Inside a club — roles, chips, whether anything agent-shaped appears.
3. The buy-in / seat sheet, and a seated (not observer) table.
4. **HHPoker / hhpoker777.com — nothing has been captured at all.** It is the
   *UI* reference in the brief, so no visual direction can be written from it
   yet.

Screenshots, when saved, belong in `Poker/reference-shots/wpk/` and
`Poker/reference-shots/hh/`.
