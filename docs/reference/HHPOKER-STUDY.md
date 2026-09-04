# HHPoker / AAPoker — the UI reference

**Author:** Esther. Screens captured from the native app.

`hhpoker777.com` is the **UI** reference in the owner's brief. This is what has
actually been seen of it. Observed unless marked **INFERENCE**.

---

## 0. Read this first — we are looking at more than one client

Three sets of screens now exist and **they do not look like the same product**:

| Set | Branding | Look |
|---|---|---|
| Club lobby, tutorial, events | **KKPoker** | Dark lobby; **light** utility screens, teal accent, iOS-like |
| Create-a-game | — | **Dark navy**, gold text, poker-chip slider thumbs |
| The felt | **AAPOKER**, watermarked `hhpoker177.com` | **Maroon** radial felt, gold buttons |

The felt screens carry HHPoker domains, so they are the reference the brief
names. The KKPoker screens are a different client.

**The client has since settled the split:** *the felt looks like HHPoker, the
functionality works like WPK.* So:

| | Reference |
|---|---|
| **How it looks** — felt, palette, type, spacing | **HHPoker** (this document) |
| **How it behaves** — lobby, liquidity, tabs, money | **WPK** (`WPK-NATIVE-STUDY.md`) |

That is a clean division and it removes the ambiguity about *which study wins*
where they disagree. It does **not** resolve one thing: the KKPoker screens and
the AAPoker screens are both filed under "HHPoker" and look nothing like each
other. Before Phase B1 samples a colour, somebody has to point at one felt and
say *that one*.

**It also raises the stakes on §4.** If the felt is the visual brief, then a felt
we have never seen in play is the single biggest hole in the plan.

---

## 1. The felt

The screen the whole plan is blocked on. Four shots: an idle table, the join
sheet, and an error.

### Layout

- **Maroon radial felt** — lighter at the centre, falling to near-black at the
  edges. Not a green oval, and not the dark navy of the create screen.
- **Empty seats are dashed circles** labelled `Empty` and `Reserve seat` — the
  chair is drawn as an absence, not as furniture.
- **The centre carries a watermark block**, not decoration: table name,
  **invitation code**, blinds, and two website URLs. On an idle table a large
  **AAPOKER** wordmark sits over it with gold **Start** and **Share** buttons.
- **Bottom bar, four controls:** a list/history icon, a spade, a **microphone**,
  and an overflow `•••`. Hamburger sits top-left.
- A **"Pray Wealth" mascot** — a god-of-fortune figure — sits bottom-left,
  overlapping the felt. Promotional, and it is *on* the play surface.
- Status text runs along the bottom centre: `wait for next`.

### What that tells us

**The invitation code is printed on the felt itself.** That closes the loop with
the access model in `WPK-NATIVE-STUDY.md` §1A.1b — a private table is reached by
code, and the table shows you the code so you can pass it on. **Share** sits
next to **Start** for the same reason. Getting people to the table is treated as
part of the table, not as a lobby concern.

**Voice is a primary control**, not buried in a menu. We have voice notes on the
socket already; they are not surfaced like this.

**INFERENCE:** the seat ring looks like nine positions. Worth confirming by
counting on a full table — see §4.

---

## 2. The join sheet

Opened over the felt, dark panel:

- Table name, close X
- `Small Blind/ Big Blind  1/2` and `Buyin  200`, side by side
- A **Min ——— Max slider** with a gold thumb for choosing the buy-in
- `Total coins: 0` and **`Fee: 20`** on separate lines
- Gold **Join Game** button

**The fee is quoted before you sit,** as its own line, separate from the buy-in.
Ours is not shown at the point of sitting.

**Failure state:** an iOS-style alert — *"Not enough Gems. Please purchase in the
Store"*, with **Cancel / Purchase**. So the sheet does not silently refuse, and
the refusal routes straight to the shop.

> Compare ours: the buy-in sheet permits a below-minimum buy-in and then parks
> the player sitting out with nothing explaining why. That is already on the
> known-broken list, and this is what the fix should look like — name the
> shortfall, offer the way out.

---

## 3. Create a game — the richest screen in any reference so far

Dark navy, gold headings, poker-chip slider thumbs.

### Game types

`NLHE` · `SNG` · `Short Deck` · `Omaha` · `POFC` · `Caribbean` 🔒 · `Cowboy` 🔒

Seven, laid out as bordered chips, the selected one gold. **Two are locked with
a padlock** — so game types are gated behind something (level, VIP, club?). We
have no unlock mechanic anywhere.

### Basic settings

| Control | Values seen |
|---|---|
| Game name | free text |
| Small/Big Blind | `1/2`, slider |
| Buy-in | `200`, chip icon |
| **Players** | **2 3 4 5 6 7 8 9** — set to **9** |
| Auto-start players count | None · 2 · 3 · 5 · 7 · 9 |
| Ante | 0 · 1 · 2 · 4 · 8 · 16 · 20 · 30 |
| Game length | 1 · 1.5 · 2 · 2.5 · 3 · 4 · 5 · 6 (hours) |
| Buy-in amount (100BB) | **a RANGE slider**, 0.5 … 8, set 1–4, with a dotted "in game option" tail |
| Min. holding chips | 0.5 … 4 |

> ⚠️ **This client allows NINE players.** The KKPoker create screen capped NLHE
> at 8 and Short Deck at 6. **The references disagree with each other.**
>
> That matters for [#62](https://github.com/poker-wealth/mypoker/pull/62): it is
> further evidence that our seat cap has to come from **our own felt**, not from
> "what the reference does", because there is no single answer to copy.

**Auto-start players count** is a real idea we do not have: the table deals
itself once N players are seated, chosen by the creator.

### Advanced settings — an anti-collusion suite

This is the part neither build plan has anything for.

| Toggle | What it is |
|---|---|
| **Ban same IP players** | Two accounts behind one connection cannot sit together |
| **Ban same GPS point players** | Same, by physical location |
| **Hide Hole-cards** | *"hidden to a player pre-flop until it's his/her turn to act"* |
| **Minimum VPIP requirement** | 0/25/30/35/40/45 %, **over 300+ hands** — a style gate |
| **Restricting onlookers** | Limits spectators |
| **Require buy-in confirmation** | Creator approves each buy-in |
| **iOS Only** | Restricts the table by platform |
| Straddle · Insurance mode · All-in or Fold · Cash out chips | Table rules |
| **Service fee (%)** | 0 · 0.5 · 1 · 1.5 · 2 · 2.5 · 3 · 4 · 5 |

**Three things worth stopping on.**

**They ship collusion controls as table settings.** Ban-same-IP, ban-same-GPS,
and hiding hole cards until it is your turn are all defences against two people
playing one hand together. We have none of them, and we are the platform selling
*provable fairness* — which today means a verifiable shuffle and says nothing
about who is sitting at the table. Fair dealing and fair play are different
claims and we currently only make one.

**The table creator sets the rake.** `Service fee (%)`, 0–5, chosen per table.
Ours is a league setting, set by administration, not by whoever opens the table.
That is a deliberate difference and probably the right one — but it should be a
decision, not an accident.

**A minimum VPIP requirement over 300+ hands** means the platform holds long-run
per-player statistics and lets a table filter on them. That is the same data the
Career tracker in Samuel's WPK study is built on.

### Cost

Bottom bar: `Balance: 💎 0` / `Cost: 💎 0`, with **Start now**. **Opening a table
costs gems**, quoted before you commit. Same currency the join sheet demanded.

---

## 4. Still not captured

- **A hand in progress.** Every felt shot is an empty or idle table, so the
  **action bar has still not been seen** — the thing Phase B3 is blocked on.
- Seat count on a full table (is the ring really nine?).
- What the locked game types unlock with.
- The advanced panel scrolled to the very bottom.
- KKPoker's 教学 → 工具 and 训练 sub-tabs.

**One more hand, played to showdown, would unblock more than everything above
combined.**
