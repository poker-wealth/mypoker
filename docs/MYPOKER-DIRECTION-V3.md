# MYPOKER — the v3 direction, and what it costs

Written 31 Aug 2026 against Operating Guide v3.0. Author: Samuel.

**Status: DRAFT — the reference study is incomplete and this document says
exactly where.** Esther owns the phase breakdown (Guide v3.0, "This week").
This is the input to it, not a replacement for it.

---

## 1. What the two references actually are

This matters more than any screen in them, and it was not obvious from the
brief.

| Reference | What it is | Role per the brief |
|---|---|---|
| `wpk.com` | **WePoker** (微扑克) | functionality |
| `hhpoker777.com` | **HHPoker** / 德扑圈 ("poker circle") | user interface |

Both are **Chinese club-and-union poker apps**. That is a specific, well-known
product category — the same family as PPPoker and PokerBros — and it is not the
category MYPOKER is currently built as.

The defining properties of that category:

- **Play happens inside clubs.** A player joins a club; the club is the unit of
  identity, not the platform.
- **Clubs federate into unions.** A union is an alliance of clubs that **share
  one lobby**, so several small clubs together produce games busy enough to run.
  This is the mechanism that solves the empty-table problem.
- **Agents mediate money.** Players do not deposit or withdraw from the platform
  directly. An agent takes the deposit, credits chips, and pays out. There is
  typically **no KYC** on the player.
- **Chips are club-scoped**, not a platform wallet balance.

HHPoker additionally advertises: Texas, Texas Cowboys, Omaha and Big Pineapple;
stake levels from 1/2 to 20/40; club management tools with permissions and a
club fund; hand-history review; opponent analysis; tournaments with prize pools;
GLI-certified shuffling; insurance; and IP/GPS restriction as an anti-collusion
control.

### How much of the above I actually verified

Plainly, because the brief said the information must come from the references:

- **Verified directly from the two sites:** their identity and branding only.
  Both are single-page apps that serve a title and nothing else to a fetcher, so
  there is no readable page content behind them.
- **Everything else in this section is secondary** — public descriptions of the
  two platforms, not a first-hand study.
- **Nothing here comes from using the apps.** The apps are the actual reference
  and neither has been installed, opened or played by anyone on this team as far
  as this document's author knows.

**This section is not finished and must not be treated as finished.** See §5.

---

## 2. The gap this opens

MYPOKER today is a **platform-lobby** product: one public lobby, tables anyone
can sit at, and a wallet the player funds themselves on-chain.

What already exists, verified in the repository rather than assumed:

| Concept | State today |
|---|---|
| Public lobby | 13 tables, live, working |
| **Agents** | Real and substantial — sub-agents, commission rates, referral links, settlements, per-agent player lists and series |
| **Leagues** | Members, join/leave, private tables, grants |
| Wallet | Direct TRON deposit and withdrawal, per-player address |
| Games | 13 felts, all render; Hold'em played end to end on a device |

So the distance is **smaller than "start again"** and **larger than "restyle"**:

1. **A league is approximately a club.** The concept exists.
2. **There is no union.** Leagues cannot federate, and nothing lets two leagues
   share a lobby. This is the single biggest functional gap, and it is the
   mechanism the references use to keep tables busy.
3. **The money model is the opposite way round.** MYPOKER funds players
   directly on-chain; the references fund players through agents. We already
   have the agent hierarchy and the commission engine — what we do not have is
   agents as the *deposit and withdrawal path*.
4. **Mobile has no league context at all.** A member can join a league and then
   never see, enter or create a league table. Recorded in
   `docs/QA-KNOWN-STATE.md` §11 and still true.

### The decision that has to be made before any of this is scheduled

**Is MYPOKER becoming an agent-funded club platform, or keeping direct
player wallets and borrowing the references' structure and look?**

These are different products, different compliance positions, and different
amounts of work. Everything below §3 depends on the answer, and it is the
owner's to make. We should not infer it from "make it like these two apps".

Per Guide v3.0: *"If something in the direction looks wrong to us, we say so and
explain why. What we do not do is quietly build it our own way."* This is that —
not a disagreement, a question that has to be answered before estimating.

---

## 3. What v3.0 changes immediately, regardless of that answer

These follow from the direction as written and are safe to act on now.

**The website stops being the product.** It describes the platform and serves
downloads. Nothing else.

- The React app currently at `mypoker777.com` is the **Telegram Mini App**, and
  it stays — Telegram runs it in a webview. It is not "the website".
- What must be built is a **separate marketing site**: what the platform is, and
  download links for Telegram / iOS / Android.
- **Browser play is out of scope.** Any QA line that reads "test this in a
  browser" is retired unless it is testing the Mini App inside Telegram.

**Three surfaces, and they are not interchangeable.** Telegram Mini App, iOS,
Android. A checklist line passed in one is not passed in the others — Telegram
identity only exists in the Mini App; hardware back only exists on Android.

---

## 4. Known-broken today, carried into any plan

From `docs/QA-KNOWN-STATE.md`, verified, not guessed. These do not disappear
because the direction changed:

- **No deployed gateway.** Blocks all of iOS and store review.
- **No SMTP mailbox.** Sign-up now requires email confirmation and fails
  closed, so **no deployed build can create an account at all** until this
  exists. This is the most urgent item on the list and it is not a code fix.
- **No privacy policy, no gambling licence.** Neither store will accept a
  submission without the first; the second is a separate legal blocker.
- Chat and voice work only in poker rooms; eight games silently discard chat.
- The buy-in sheet permits a below-minimum buy-in, which parks the player
  sitting out with nothing on screen explaining why.
- Slots renders an invented `CHERRY-BELL-STAR` line before anything is rolled,
  on both web and mobile.
- Personal Info exists on mobile but **has never been run on a device**.

---

## 5. What has to happen before this document is worth planning from

The reference study is the weakest part of this document and the part the brief
cared most about. To finish it, somebody has to **install both apps and use
them**. Specifically:

**On WePoker (functionality):**
1. Join a club. Record every step from install to sitting at a table, including
   what an agent does and what the player does.
2. Record how chips are obtained and cashed out, and what the player sees at
   each stage.
3. Record what the lobby shows when clubs are in a union versus alone.
4. Record the full table flow: seating, buy-in, rebuy, standing up, leaving.

**On HHPoker (interface):**
1. Screenshot every screen: splash, login, lobby, club list, table, wallet,
   profile, settings.
2. Record the palette, the type, the spacing, and how the table felt is laid
   out at each seat count.
3. Note what is on screen during a hand versus between hands.

Until that exists, **§1 is secondary information and anything built from it is
built on a guess.** A phase written from this document today would fail the
Guide's own test: *"A phase that only makes sense to the person who wrote it is
not finished."*

---

## 6. Suggested split

Offered, not assigned — the Guide says the two developers divide the phases
between themselves once the breakdown exists.

- **Esther** owns the reference study and the phase breakdown (Guide v3.0).
- **Samuel** continues on the backend already in flight — auth, admin,
  suspension, the money rails — which every direction needs and which is
  currently blocked on review in PR #59.
- **The marketing site** is small, self-contained, and needs no reference study.
  It can start immediately.

---

## Change log

| Date | Change |
|---|---|
| 31 Aug 2026 | First draft, against Operating Guide v3.0. Reference study incomplete and marked as such. |
