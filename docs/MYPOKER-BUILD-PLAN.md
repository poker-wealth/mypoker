# MYPOKER — how we build the app

Author: Samuel, 2 Sep 2026. Written against Operating Guide v3.0 and the
first-hand reference study in `REFERENCE-STUDY-WPK.md`.

**Status: input to Esther's phase breakdown, not a replacement for it.** The
Guide assigns the reference study and phasing to Esther. This is the
engineering read of what the references turned out to be and what that costs
us. Where it names an owner's decision, it does not make it.

---

## 0. The one-paragraph version

The references are not the product category we thought. WPK is a
**direct-wallet, public-lobby, multi-vertical gambling platform** — which is
structurally what MYPOKER already is. We do not need to become a club-and-union
agent platform, and the biggest item in the old plan (build unions) is not what
keeps WPK's tables busy. What keeps them busy is **pooling** (one Zoom row with
274 players), **scheduling** (six concurrent tournaments with 14–173 entrants),
and **presentation** (tiering, occupancy rings, a face on every row). We have
the engines, the wallet, the fairness layer and nine casino games already. We
are missing the concentration mechanics, tournaments entirely, and a shop
window. That is the build.

---

## 1. What we already have

Verified in the repo on 2 Sep 2026, not from memory.

**Poker engines** — `game-server/src/games/texas/` deals three variants through
one shared betting/side-pot/showdown/settlement path: `texas`, `short-deck`
(36-card, flush over full house, A-6-7-8-9 low straight) and `omaha`
(pot-limit). Adding a variant touches the deck, the hole-card count and the
evaluator, and nothing else. That is a good foundation and it is already the
shape WPK's lobby implies.

**Nine other games**, all shipped: `baccarat`, `niu-niu`, `dou-di-zhu`,
`san-zhang`, `red-packet`, `cowboy-beauty`, `lottery`, `slots`, `texas-cowboy`.
Compare WPK's Games tab: Texas Cowboy, Poker Master, Slots, Casino Hold'em,
Lucky 6 Baccarat. **We already overlap on most of their casino vertical.**

**Money** — `financial-core/` has `wallet`, `deposit`, `withdrawal`,
`clearing`, `settlement`, `vip`, `reputation`, `reinsurance`,
`circuit-breakers`. This is a direct player wallet, which the study says is the
right model.

**Agents** — `game-server/src/agents/` (registry, permissions, commission,
dashboard) plus `financial-core/src/agent/`. Substantial and working.

**Leagues** — `game-server/src/league/` and `financial-core/src/league/`
(funding, grants, store), surfaced on mobile as `AllianceScreen`. Note the
name: "Alliance" here means *the list of leagues you are in or could join*, not
a federation. **Leagues still cannot federate.**

**Jackpot** — `game-server/src/jackpot/` (engine, schedule, tiers, weights)
already exists, with a `JackpotScreen` on mobile.

**Mobile** — Lobby, Games, Table, Wallet, AgentCenter, Alliance, Jackpot, Vip,
Fairness, Data, FeltGallery, Profile, PersonalInfo, Settings, Notifications,
Login.

**Fairness** — provably-fair shuffle with on-chain rule commitment, and a
catalogue that distinguishes `PROVABLE` from `VENDOR_ATTESTED` in the data
rather than in marketing copy. **WPK has nothing comparable.** This is the one
place we are ahead of the reference, and it should not be traded away to look
more like them.

## 2. What we are missing

| Gap | Evidence | Severity |
|---|---|---|
| **No tournaments at all.** `grep -ri tournament\|MTT` across `game-server`, `financial-core` and `mobile` returns one hit, in a table-design file. | WPK runs 6+ concurrent MTTs with 14–173 entrants each | **Critical** |
| **No fast-fold / pooling.** No `zoom`, `fastFold` or pool concept anywhere. | WPK's two Zoom rows hold 266–274 players | **Critical** |
| **Lobby presentation.** No tier filters, occupancy ring, MVP badge, HOT badge or live ticker. | Every WPK row carries all of these | High |
| **No ante concept at all.** `grep -ri ante game-server/src/games/texas/` returns nothing. | WPK's Short Deck is **ante-only, with no SB/BB control whatsoever**. Ours inherits `smallBlind: 10, bigBlind: 20`. The betting engine cannot express how the reference deals Short Deck. | **High — largest engine gap** |
| **Seat counts disagree with each other, before you even reach WPK.** `game-catalog.ts` says `maxPlayers: 9` for texas, short-deck and omaha; `live/server.ts` actually seats **6** (Texas, Omaha, from `DEFAULT_ROOM`) and **8** (Short Deck). | WPK's own creation dropdown: NLHE 8, Short Deck 6 | Medium — **but see §3, it is Victor's call** |
| **No join code.** `visibility: 'public' \| 'private'` exists in `player-table-routes.ts`, and `CreateTableSheet` offers 2–9 seats, but no code. A private table is merely *unlisted*; the creator cannot let a specific person in. | WPK's Friends tab: "Join Table — join with code" | Medium |
| **No table lifespan.** | WPK sets Duration 0.5–8h at creation; HH's lobby countdown is time left, not elapsed | Medium |
| **No straddle, bomb pot, AOF, splash, or Run It Twice.** No `straddle` or `runItTwice` in the codebase. | All offered by WPK; straddle and RIT are toggles on its create screen | Medium |
| **No union / league federation.** | WPK doesn't have one either — see §3 | **Low. Deprioritise.** |

## 3. Three decisions the study settles

**Unions are not the answer to the empty lobby, and should come off the
critical path.** The old plan called league federation "the biggest functional
gap, and the mechanism the references use to keep tables busy". The references
do not have unions. WPK keeps tables busy by pooling and scheduling. Building
federation would have been a large piece of work aimed at the wrong mechanism.

**We do not become an agent-funded club platform.** No agent, commission,
union or alliance string appeared in 31 screens covering every tab, the wallet,
the promotions centre and a live table. WPK's money sits in a four-currency
wallet on the player's own profile. Our direct-wallet model matches the
reference; keep it.

**The remaining owner's call is much smaller than V3 posed it.** Not "agent
platform or direct wallet" — that is answered. The narrow question is whether
the existing agent system stays as a **distribution and commission channel**
(referral links, sub-agents, revenue share) while money stays direct
player↔platform. That costs almost nothing, since it is already built, and it
is compatible with everything below. **Victor's call, and only that.**

One caveat kept honest: everything above is from the **H5 web build**, and
Wallet → "Management" was never opened. If Management turns out to route money
through an agent, §3 needs revisiting. That single screenshot is still the
cheapest, highest-value thing anyone can capture.

## 4. The build

Ordered by what actually fixes the business problem. A player who opens the app
and finds no game is the whole problem; nothing later matters until that is
false.

### Phase 0 — unblock (not engineering work, but it gates everything)

Nothing below can be tested by a real user until these land. They are owned by
other people and should be chased daily.

- **SMTP mailbox.** Sign-up requires email confirmation and fails closed, so
  **no deployed build can create an account at all.** With qiqi. Most urgent
  item on the project.
- `GOOGLE_CLIENT_ID`; a deployed gateway (blocks iOS and store review);
  privacy policy; gambling licence.

### Phase 1 — make the lobby honest about where the players are

Cheap, entirely presentational, and it is most of what makes WPK's lobby feel
alive despite a dead long tail.

1. **Tier filters** — Micro / Low / Mid / High per category, so a player never
   sees the whole list at once.
2. **Occupancy ring** — `n/max` in a ring that fills, not a bare number.
3. **MVP badge** — avatar and nickname of the table's top winner on every
   occupied row. A face on a row beats a number on a row.
4. **HOT badge** on the busiest row in each category.
5. **Live win ticker** across the lobby, real names and amounts. We already
   settle every hand; the data exists.
6. **Reorderable categories** — long-press to reorder, as WPK does.

Definition of done, per the Guide: run it yourself on a device against a
running server, and have someone else test it.

### Phase 2 — pooling (the single highest-leverage feature)

Fast-fold. One row, one player count, no seat map: fold and you are dealt into
a new hand at a new table immediately. This is what turns thirteen dead tables
into one live row.

- New room type alongside `poker-room.ts`, sharing the existing hand engine.
- Lobby row renders a **player count, not `n/max`** — the row is a pool.
- Start with NLHE only, at one or two stakes. Resist spreading it.

This is the change most likely to move the number that matters. It should not
wait behind variant work.

### Phase 3 — tournaments

The gap with no code at all behind it, and WPK's clearest liquidity engine: a
scheduled start time is a reason to come back at 20:00 rather than never.

- Registration, late registration with a visible countdown, blind schedule,
  table balancing, break handling, prize-pool distribution, bounties.
- Lobby rows exactly as observed: status block (**Late Reg CLOSES IN 32:56** /
  **STARTS IN 1h56m**), start time, buy-in, entrant count, prize pool.
- **Advertise overlay**, as WPK does — it is a lure, and an honest one.
- Denominate in both soft currency and cash, as they do.

Sequenced after pooling because pooling helps every hour of the day and a
tournament helps at its start time; but this is the larger piece of work and
should start being designed during Phase 2.

### Phase 4 — variant depth

Now that there are players to spread, add the formats that give them reasons to
move between rows. All four are small next to Phase 3.

- **Straddle** — stake notation becomes `SB/BB (straddle)`. Enables "Loose"
  tables.
- **Bomb pot** — periodic forced all-in-to-flop hand.
- **AOF** — all-in or fold, **fixed 8bb buy-in at every level**, exactly as
  observed.
- **Splash pot.**
- **Ante support** — a prerequisite, not a nicety. WPK's Short Deck has no
  blinds at all. Ours cannot express that. This is engine work, not config.
- **Join code** for private tables, so "private" means invitable rather than
  merely unlisted.
- **Table duration**, set at creation, 0.5–8h.
- **Run It Twice** after all-in.
- **Seat counts: do not touch without Victor.** Our three numbers already
  disagree (catalogue 9, live 6, Short Deck 8). Short Deck's 8 is Victor's
  explicit instruction and the wide felt art has eight chairs drawn on it. WPK
  says 6. That is a conflict between the owner and the reference and it is his
  to resolve. See `WPK-NATIVE-STUDY.md` §1A.1(a).

### Phase 5 — retention machinery

We own more of this than we think; most of it is wiring, not building.

- **Wire the existing jackpot module to tables** — a per-table counter on the
  felt (WPK shows `JP 503`) and a category-wide odometer above the list (they
  show 336,393 on AOF). The engine, tiers, weights and schedule already exist.
- **Scheduled promotions** — we already ship a red-envelope game; WPK runs a
  "red-envelope rain" Mon–Wed at 15:00. Turning a game we own into a recurring
  scheduled event is a content and scheduling job, not an engine job.
- **Wagering rebate ("Betback")** on the casino vertical.
- **A Career-style tracker** — session P&L, per-starting-hand win rate,
  positional stats, opponent lookup. WPK gives this away free and it is a real
  retention hook for serious players. We hold every hand already.
  Note their retention limits: hand history 3 days, rival stats 7/30/90.

### Phase 6 — clubs, and only then federation

Match the observed model: a player **creates or joins a club themselves, in two
taps**, from a Friends-style tab that also carries "play with friends" and
"join by code". Our leagues are already roughly this; the work is surfacing it
that plainly, and mobile currently has no league context at all.

**Federation stays off the plan** unless the owner wants it for its own sake.
It is not what the references use.

## 5. What we deliberately do not copy

Naming these now stops them arriving later as "the reference does it".

- **Sports betting inside the poker table.** WPK puts a football button on the
  felt. That is a different licence, a different product and a different
  compliance position.
- **Interstitial ads on launch**, and marquee ads inside a live hand.
- **Mirror domains** advertised in-app (`web.wpk180.com`) — that is
  block-circumvention furniture.
- **Untranslated promotion screens.** Their entire promo centre is Chinese in
  an otherwise English UI. We ship i18n properly or not at all.
- **No-KYC play**, whatever they do.
- **Trading away provable fairness** to look more like them. It is the only
  axis on which we are ahead.

## 6. Known-broken, carried into any plan

These predate this document and are not fixed by it:

- Buy-in sheet permits a below-minimum buy-in; the player is then parked
  sitting out with nothing explaining why.
- Slots renders an invented `CHERRY-BELL-STAR` line before anything is rolled,
  on both platforms.
- Chat and voice exist only in poker rooms; eight games silently discard chat.
- Mobile has no league context at all.
- Personal Info screen on mobile — built and typechecks, **never run on a
  device**.
- Last session's auth/admin work — tests pass, but nothing has been exercised
  against a running server. Per the Guide, anything touching access, money or
  user data needs a *who-can-reach-this* test.
- Section 4 checklist lines 6, 8, 9, 10 (Telegram identity, session
  persistence, session expiry, sign out) — untested on every surface.
- **Every store in the repo is mocked. There is no Mongo-backed test harness.**
  Mutating the real `user-store` to reintroduce an account-takeover leaves the
  suite green. The decisions are covered; the writes are not. Victor needs this
  before signing off PR #59.

## 7. What this plan still cannot say

- **The visual direction.** HHPoker is the UI reference in the brief and
  **nothing has been captured from it at all**. Everything in §4 is structure
  and behaviour. Palette, type, spacing and felt treatment wait on HH
  screenshots.
- **The money model, at the last inch.** Wallet → "Management" was never
  opened. §3 holds unless that screen says otherwise.
- **Whether the native app differs from the H5 build.** All 31 screens are web.

## 8. Ownership

The Guide assigns the reference study and phase breakdown to **Esther**. This
document and `REFERENCE-STUDY-WPK.md` are handed to her as input. Two things
need her before anyone writes code: the **seat-count correction** (it touches
PR #61, which she owns) and the **phase ordering** above.

Victor's decisions, and only these: whether the agent system stays as a
distribution channel (§3), and whether federation is wanted for its own sake
(§4, Phase 6).
