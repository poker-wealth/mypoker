# MYPOKER — build phases under the new direction

**Owner brief, 31 August 2026.** The website describes the platform and offers the
download, nothing else. The game is played only in the Telegram mini app, on iOS
and on Android. `wpk.com` is the brief for **how it works**; `hhpoker777.com` is
the brief for **how it looks**.

This document is the breakdown of that into phases anyone can pick up. Read
§1–§4 once; after that each phase in §5 stands alone.

---

## 1. How the references were studied, and what that did not cover

**Be aware of this before trusting anything in §2.** Both sites are
JavaScript-rendered single-page apps. Fetching them returns the page title and
nothing else — no navigation, no layout, no copy. Everything in §2.1, and the
documentation half of §2.2, therefore comes from **public writing about** the two
platforms rather than from reading the sites.

**Three real screenshots have since been supplied** and are written up in
§2.2.1–§2.2.5: the club lobby, the tutorial tab and the events tab. They are
worth more than all the documentation combined — they added an entire phase
(Phase 7) that the first draft of this plan did not have, and they corrected a
colour rule that would have been wrong on every screen.

**That is the argument for finishing the capture rather than starting to build.**
Three screens changed the plan this much; nine are still missing.

**Still missing, and still Phase 0:**

| Screen | Why it matters |
|---|---|
| Splash · loading | Named directly in the brief |
| Login / sign-up | Phase 3 cannot be specified without it |
| Club list (not the interior) | How you find a club before joining one |
| **The felt, and the action bar** | The most important screen in the product |
| 俱乐部 tab | One of five, entirely unseen |
| 我的 (profile) · settings | |
| 教学 → 工具 and 训练 | Two unseen sub-tabs inside Phase 7 |
| Wallet / deposit / withdraw detail | Feeds decision §4.1 |

For each: a screenshot on iPhone and Android, the colour behind it, the corner
radius, the spacing rhythm, where the primary action sits, and the type scale.
Plus one recording of cold start → login → club → sit → hand → leave.

Until the felt is captured, **Phase 5 is a list of components, not a
specification** — and Phase 5 is the largest phase in the plan.

---

## 2. What the references are

### 2.1 wpk.com (WePoker / 微扑克) — the functionality brief

> **WITHDRAWN — this section was wrong, and wrong in its central claim.**
> Superseded by Samuel's `REFERENCE-STUDY-WPK.md`, written from **31 first-hand
> screens** of `h5.wpk.com` covering every tab, the wallet and a live table.
> Kept rather than deleted so the error is legible, because how it happened
> matters more than that it happened.

**What this section claimed:** that WPK is a club-and-union platform; that play
happens inside clubs; that you join via an agent who handles all deposits and
withdrawals; and — the headline — that WPK carries no gaming licence because
there are *no financial facilities in the app at all*.

**What 31 screens show:** none of it.

| Claimed here | Actually observed |
|---|---|
| Play happens inside clubs | Lobby is the default tab and carries the game |
| Clubs federate into unions | No union, alliance or federation anywhere |
| Agents mediate money | **Zero mentions of agent or commission in 31 screens** |
| No money in the app | A **four-currency wallet** on the player's own profile |
| You need an agent to join a club | A player creates or joins a club themselves, in two taps |

**How it went wrong, because the failure mode will recur.** Both sites are
JavaScript-rendered, so the fetch returned nothing (§1) and I fell back to web
search. The results were `worldpokerdeals.com`, `pokerbotai.com`,
`crownaipoker.com` — **poker-bot vendors and rakeback brokers**. Those sites
describe the PPPoker club-and-union model and attach WPK's name to it, because
that is the model they sell into. I read a bot vendor's sales page as a product
spec.

Samuel diagnosed this independently before seeing this document, which is a fair
sign it was the obvious trap and I walked into it.

**The rule that follows:** for a reference platform, a screenshot outranks any
amount of search. Where we have no screens we say so and stop, rather than
filling the gap with whatever ranks.

**What WPK actually is:** a **direct-wallet, public-lobby, multi-vertical
gambling platform** — structurally what MYPOKER already is. The consequences for
the plan are in §4.1, and they are much smaller than this section originally
made them.

### 2.2 hhpoker777.com (HHPoker / 德扑圈) — the UI brief

From documentation:

- Positions itself around **playing with people you know** — private, social,
  club-based — rather than an open cash-game lobby.
- Sells on **fair shuffling** and on feeling like a real live game.
- **iOS 14+, Android 8.1+.**

**Its distribution is a finding in its own right.** The official instructions
tell iOS users to install *through a mobile browser* and then **"trust"** the
app in Settings — that is an enterprise/ad-hoc certificate, not the App Store.
Android users are told to **allow installation from unknown sources** — a direct
APK. A Google Play build is mentioned only for players outside mainland China.

So the reference platform we have been given for iOS and Android **is not
distributed through the stores** in its main market. That is not an accident,
and §4.2 explains why it matters to us.

#### 2.2.1 First real screen — the club lobby

One screenshot has been supplied: the **club interior**, 大厅 (Lobby) tab, club
永旺德州 / ID 88888. Everything below is read off that image. It is one screen of
the dozen listed in §1 — Phase 0 still stands — but it is real, and it settles a
lot.

**Layout, top to bottom.**

1. **Title bar.** Club name centred, dark. A red-packet (红包) badge top-right.
2. **Club header.** Square rounded club logo left. Club name large and white.
   **`ID 88888` directly under it with a copy affordance** — the club ID is a
   first-class, shareable identifier. Right side, two icon-over-label actions:
   **成员 (12232)** members, and **牌局记录** hand records — both scoped to the club.
3. **Balance row.** USDT token mark, `USDT: 0`, and an **eye icon to hide the
   balance**. Right-aligned, three dark pill buttons: **充币** (deposit),
   **提币** (withdraw), **红包** (red packet).
4. **Promo banner.** Full-bleed, the one saturated element on the screen:
   gold/orange, coins and cards, reading **"区块发牌 · 过程可验"** —
   *blockchain dealing, the process is verifiable*. Provable fairness is
   marketed, loudly, at the top of the lobby.
5. **Deck filter.** 全部 (all) · 长牌 (full deck) · 短牌 (short deck), the active
   one green with a green underline. A sort control at the right.
6. **Table rows.** Each one:
   - A **circular occupancy ring** — `5/7`, `4/7` — the arc filled in proportion
     to seats taken. This is the strongest single design idea on the screen.
   - Table name and number, dim: `永旺娱乐(短牌) 27121`, `三倍前注(短牌) 27105`
     — note **三倍前注 = triple ante**, a stake structure we do not have.
   - Stakes bold and white (`0.2/0.4`, `2/6`) beside a **cyan running clock**
     (`00:55:36`).
   - A shield icon and **保险 (insurance)** tag.
   - Right: **最小买入** (minimum buy-in) over a USDT mark and figure.
   - A ghosted felt illustration watermarked behind the row.
7. **Bottom tab bar, five tabs.** 大厅 (lobby) · 教学 (tutorial) · 俱乐部 (club)
   · 活动 (events) · 我的 (mine). Active tab green.

**Colour, eyeballed from a compressed screenshot — re-sample on device before
building.**

| Role | Approx. | Notes |
|---|---|---|
| Ground | `#0D1117`–`#10161A` | Near-black, slight blue-green cast. Not pure black. |
| Row / card | one step lighter than ground | Separation by value, not by border. |
| Primary text | near-white | Club name, stakes, buy-in figure. |
| Secondary text | mid grey | Table names, labels — a **big** drop from primary. |
| Accent | bright mint green | Active tab, underline, occupancy arc, USDT mark. |
| Data | cyan | The running clock only. |
| Promo | saturated gold/orange | Banner only. Nothing else on the screen is warm. |

**What this tells us about the look:** dark, calm, and almost entirely
monochrome, with green reserved for *state* (what is active, how full a table
is) and a single loud banner carrying all the colour. Contrast between primary
and secondary text is doing most of the hierarchy work — very little is done
with borders or boxes.

**Three things they have that we do not:** a **tutorial** tab, an **events**
tab, and a **triple-ante** table type. Two of those are whole product areas —
see 2.2.2 and 2.2.3.

#### 2.2.2 教学 — the tutorial tab

Not a help page. A **content platform**, with its own four sub-tabs:
**知识** (knowledge) · **工具** (tools) · **训练** (training) · **我的** (mine).

Under 知识, two filter chips — **策略视频** (strategy video, active, solid green
pill) and **知识文章** (articles, inactive, dark outlined pill) — over a feed of
numbered lessons:

- 第1课 — *Where exactly are you losing?*
- 第2课 — *First step to stop the bleeding: build a starting-hand structure*
- 第3课 — *Open or Fold: stop limping preflop*
- 第4课 — *Facing a raise: Call, …*

Each row: title over two lines, then a timestamp (`2026-08-05 12:18`), a **like
count** (858) and a **view count** (157.8k), with a 16:9 video thumbnail and play
overlay on the right.

**What that implies for us,** and it is not small: video hosting and streaming, a
CMS someone publishes lessons through, per-item like and view counters, an
article reader, and two further sections (**tools**, **training**) not yet seen.
We have none of it. This is its own phase — see Phase 7.

#### 2.2.3 活动 — the events tab

Titled 永旺专属活动 ("Yongwang exclusive events"), so events are **scoped to the
club**, not the platform. A green KKPoker banner — *"公平，是竞技的起点"*,
**fairness is the starting point of competition** — over a list of promotions:

| Item | Meaning |
|---|---|
| VIP专属群 | VIP exclusive group |
| 大牌奖励 | Big-hand reward (a bad-beat/high-hand style bonus) |
| 推荐红包 | Referral red packet |
| 幸运骰子 | Lucky dice |

Each is a dark card: a large glossy 3-D icon left, bold label, and a
**blue pill CTA — 立即查看** ("view now") right.

We have `Jackpot` and `Vip` screens, and a red-packet game, but no events hub and
no referral or lucky-dice mechanic. Also Phase 7.

#### 2.2.4 Corrections to 2.2.1 now three screens are visible

- **Blue is the action colour, not green.** Green marks *state* — the active
  tab, the active filter chip, the occupancy arc. Every actual button
  (立即查看) is **blue**. Reading green as the CTA colour would have been wrong
  everywhere.
- **The ghosted watermark behind list rows is a system**, not a one-off on the
  table list. It recurs on the events list.
- **Banners are per-context and carry the loud colour**: gold in the lobby,
  green on events. The rest of every screen stays near-monochrome.
- **The card is the unit.** Dark rounded rectangle, generous internal padding,
  separated by gap rather than by rule. Almost nothing on these screens has a
  visible border.

#### 2.2.5 One thing to settle before building

The screens are branded **KKPoker** — the club logo in the lobby and the events
banner both say so. `hhpoker777.com` was given as the reference. These gateway
domains commonly front one of several club apps, so somebody should confirm
**which app we are actually copying** before Phase 2 samples colours from it.
It does not change anything above; it does change what gets installed in Phase 0.

**Two things we have that this screen confirms are right:** per-table
**insurance** (we have `InsurancePrompt`) and **provable fairness** — which they
put on a banner rather than burying in a menu, and we currently bury in a menu.

---

## 3. What we already have

This is not a rebuild from zero, and any plan that treats it as one will be
wrong about the cost. Audit as of today:

| Piece | State | Under the new direction |
|---|---|---|
| `game-server` | 12 games, live WebSocket tables, provably-fair shuffle, gateway/auth/admin | **Keeps.** Direction changes clients, not the engine. |
| `financial-core` | Ledger, settlement, TRC-20 USDT deposits + withdrawals, notifications | **Keeps, and stays central.** Both references carry an in-app wallet — see §4.1. |
| `frontend` (React + Vite) | 15 screens, 8 locales, the full game UI, Telegram-aware | **Becomes the Telegram mini app.** It is already that; it just stops being "the website" too. |
| `mobile` (Expo React Native) | Every screen mirrored: Lobby, Games, Table, Wallet, Alliance, AgentCenter, Vip, Fairness… | **Becomes the iOS + Android app.** Much further along than "start the mobile app" implies. |
| Marketing website | **Does not exist.** No landing page anywhere in `frontend/src/pages/`. | **Entirely new**, and now the only thing the website is. |

**The club model largely exists already, under a different name.** What WePoker
calls clubs/unions/agents, we call **leagues** — `Alliance.tsx` already does
create/discover/join, and `AgentCenter.tsx` plus `GrantSheet` / `FundMembersButton`
already do agent funding of members. The vocabulary differs; the structure does
not. Aligning naming is cheap. Rebuilding the concept would be waste.

### Games in the catalogue

Texas Hold'em · Short Deck · Omaha · Dou Di Zhu · Niu Niu · Zha Jin Hua ·
Baccarat · Red Packet · Slot Machines · Cowboy & Beauty · Lottery · Texas Cowboy

Each has a server engine and a web felt. **None has a native felt in `mobile`
beyond the shared table screen** — see Phase 6.

---

## 4. Three decisions that block honest estimates

The brief says that where the direction looks wrong we say so and explain why,
and that we do not quietly build it our own way. These are those points. Each is
the owner's call; none should be guessed at by a developer mid-phase.

### 4.1 Does money stay inside the app? — **largely settled: yes**

This was posed as the decision everything waited on. It was posed that way
because §2.1 was wrong. With first-hand evidence it mostly answers itself.

**Both references keep money in the app.**

- WPK: a four-currency wallet (Diamond / Gold / USD / Points) on the player's own
  profile, with Redeem and a Management link. No agent anywhere in 31 screens.
- The KKPoker screens Esther captured show **充币 (deposit)** and **提币
  (withdraw)** buttons and a **USDT balance with a hide toggle**, in the club
  lobby (§2.2.1). Direct crypto wallet, in-product.

So our on-chain USDT deposit and withdrawal work is **aligned with both
references, not in conflict with them**. Nothing is stood down. `financial-core`
stays central.

**What remains open is much narrower**, and it is two things, not a fork:

1. **Does the existing agent system stay as a distribution and commission
   channel** — referral links, sub-agents, revenue share — while money stays
   direct player-to-platform? It is already built (`game-server/src/agents/`,
   `financial-core/src/agent/`), it costs almost nothing to keep, and it is
   compatible with everything in §5. **Owner's call.**
2. **WPK's Wallet → "Management" was never opened.** If deposits turn out to
   route through an agent there, point 1 reopens. One screenshot settles it, and
   it is the cheapest outstanding item in the whole plan.

**What does *not* follow from this.** Keeping a real-money wallet still closes
the app-store route (§4.2) — that consequence was correctly identified even
though the reasoning that led to it was not. Store policy does not care which
reference we copied.

### 4.2 "iOS and Android" — stores, or sideload?

They are different products, different work, different risk.

Apple and Google both refuse real-money gambling apps without licensing and
geographic restriction. This is precisely why HHPoker ships via enterprise
certificate and direct APK (§2.2).

- **Store route.** Requires (A) above. Normal updates, normal trust, discoverable.
- **Sideload route.** Matches the reference exactly. But: enterprise certificates
  get revoked — and when one is revoked *every installed copy stops opening at
  once*; every update is a manual reinstall; and Android users must be talked
  through disabling a safety setting. It also means the download page in Phase 1
  carries install instructions and a trust walkthrough, which is real design work.

**This must be decided before Phase 9, and it changes Phase 1.**

### 4.3 Telegram and real money

The mini app is the third surface, and Telegram has its own rules about what may
be monetised in-app. If (B) is chosen, someone needs to confirm the mini app can
carry it. Cheap to check now; expensive to discover at launch.

---

## 5. The phases

Each phase states: **Goal · Why · Scope · Where · Done means · Depends on · Not
in scope.** "Done means" is the acceptance test — if it cannot be demonstrated,
the phase is not done.

---

### Phase 0 — Capture the references *(blocks every UI phase)*

**Goal.** Turn both reference apps into material a developer can build from.

**Why.** §1 — three screens are in, nine are not, and the missing ones include
the felt. Phase 5 cannot be specified until it is captured.

**Scope.**
1. Install the reference app on a real iPhone and a real Android device.
   **First settle §2.2.5** — the screenshots are branded KKPoker while the brief
   names hhpoker777.com, so confirm which app we are copying before sampling
   anything from it.
2. Capture the nine screens still listed in §1, both platforms.
3. Record the cold-start → login → club → sit → hand → leave flow in each.
4. Write `docs/reference/FLOWS.md`: for each screen, what it shows, what you can
   do, and what happens next. Functionality only — that is wpk's job.
5. Write `docs/reference/UI.md`: colours (hex, sampled), corner radii, spacing
   steps, type sizes and weights, icon style, where the primary action sits,
   what a loading state looks like, what an empty state looks like.
6. Note anything we do that they do not, and anything they do that we cannot.

**Where.** New directory `docs/reference/`, plus `docs/reference/shots/`.

**Done means.** A developer who has never opened either app can read the two
documents and build a screen that would not look out of place in HHPoker.

**Depends on.** Someone with both devices and a club invitation — WePoker needs
an agent to let you in, so **start the access request today**, it is the long
pole.

**Not in scope.** Any code.

---

### Phase 1 — The marketing website

**Goal.** A site that explains the platform and hands over the download. Nothing
else.

**Why.** It does not exist, and under the new direction it is the *only* thing
the website is.

**Scope.**
- Landing: what MYPOKER is, who it is for, the games, provable fairness.
- Download: Telegram, iOS, Android. Per §4.2, the sideload route also needs
  step-by-step install instructions with screenshots, including the iOS "trust"
  step and the Android unknown-sources step.
- Support/contact, and the legal pages a real-money wallet requires.
- Responsive, fast, and **it must not import the game client** — the point of the
  split is that the website is not the game.
- 8 locales, matching the app.

**Where.** New. Recommend a separate deployable (`website/`) rather than routes
inside `frontend/`, so the game bundle cannot leak into it and the two deploy
independently.

**Done means.** A stranger can land on it, understand what the product is, and
install the app on their own phone without asking anybody how.

**Depends on.** Phase 0 for visual language. §4.2 for what the download page says.

**Not in scope.** Sign-in, lobby, any gameplay. If it is playable, it is wrong.

---

### Phase 2 — Design system from the UI reference

**Goal.** One set of tokens and primitives that both clients build from.

**Why.** hhpoker777 is the look. Applying it screen-by-screen guarantees drift;
applying it once at the token layer does not.

**Scope.**
- Extract from `docs/reference/UI.md`: colour ramp, spacing scale, radii, type
  scale, elevation, motion timings.
- Map onto the existing token layer in `frontend/src/index.css` — keep the
  token *names* (`bg-surface`, `text-dim`…) and change their *values*, so the
  existing 15 screens re-skin without being rewritten.
- Mirror the same values into `mobile/src/theme.ts`.
- Update the shared primitives in `frontend/src/components/ui/`.
- Publish a one-page swatch/spec screen so drift is visible.

**Done means.** Changing a token changes both clients. A new screen built from
tokens alone looks like the reference without extra styling.

**Depends on.** Phase 0.

**Not in scope.** Per-screen redesign — that is Phases 3–6.

---

### Phase 3 — App shell: splash, loading, login

**Goal.** Everything before the lobby, on all three surfaces.

**Why.** Called out explicitly in the brief ("splash screen · loading screen
re-arrangement · login page"), and it is the first thing anyone sees.

**Scope.**
- **Splash.** Native splash in `mobile` (expo-splash-screen is already a
  dependency); the mini app equivalent in `frontend`. Brand-correct, no flash of
  wrong background.
- **Loading.** The brief says *re-arrangement*, so treat the current sequence as
  wrong: audit what happens between launch and first usable screen, remove
  double-loads, make one deliberate progression. Skeletons, never spinners on
  content we can shape.
- **Login.** Match the reference: email + password, no ID (§2.1). Keep Google and
  Telegram sign-in. Errors must not say which field was wrong — that has already
  been fixed server-side and the clients must not undo it.
- Session restore: a returning player should not see the login screen at all.

**Where.** `frontend/src/pages/Login.tsx`, `mobile/src/screens/LoginScreen.tsx`,
`mobile/src/auth.tsx`, splash config in `mobile/app.json`.

**Done means.** Cold start on a real device reaches the lobby with one
progression and no flicker; a returning player skips login.

**Depends on.** Phases 0 and 2.

> ⚠️ `mobile/src/auth.tsx` still maps the retired login codes `no_account` /
> `wrong_password`. The server now returns `invalid_credentials`. Whoever picks
> this up must update that mapping or login errors will render blank.

---

### Phase 4 — Lobby and clubs

**Goal.** Find a club, join it, find a table, sit down.

**Why.** This is WePoker's core loop, and it is what the lobby is *for* under the
new direction.

**Scope.**
- Rework the lobby around **clubs first**, matching wpk's flow: apply to a club →
  agent approves → see that club's tables.
- Decide the naming: we say *league*, the reference says *club*. Pick one and use
  it everywhere including the 8 locale files.
- Agent view: approve members, fund them, see their activity. Much of this exists
  in `AgentCenter.tsx` and `GrantSheet` — extend, do not rewrite.
- Table list per club: variant, stakes, seats filled, waitlist.
- Bring `mobile` to parity.

**Where.** `frontend/src/pages/{Lobby,Alliance,AgentCenter}.tsx`,
`mobile/src/screens/{Lobby,Alliance,AgentCenter}Screen.tsx`, league routes in
`game-server/src/gateway/`.

**Done means.** A new account can apply to a club, be approved by an agent, and
reach a seat — on all three surfaces, without touching an admin tool.

**Depends on.** Phase 3.

---

### Phase 5 — The game board (Texas Hold'em first)

**Goal.** One felt, correct and good-looking, on all three surfaces.

**Why.** It is where players spend their time, and it is the hardest screen. Get
it right once and Phase 6 is repetition.

**Scope.**
- Re-skin the felt to the reference: seat ring, board, pot, action bar, chips,
  timers, winner reveal.
- Portrait and landscape; the wide felt already exists for Short Deck and Omaha.
- Action bar: fold/check/call/raise with pot-fraction shortcuts, all-in confirm,
  bold broadcast of what each player did.
- Time bank UI on the reserve clock (server side is done and tested).
- Chat, voice notes, unread count.
- **`mobile` needs a real felt.** This is the largest single piece of remaining
  work in the whole plan.

**Where.** `frontend/src/components/poker/`, `mobile/src/table/`.

**Done means.** A full hand plays end-to-end on iPhone, Android and the mini app;
every player can tell whose turn it is, what was bet, and who won, without asking.

**Depends on.** Phases 2 and 4.

---

### Phase 6 — The remaining games

**Goal.** Each of the other eleven, to the Phase 5 standard.

**Why.** The catalogue is the product's breadth, and today the felts are
web-only.

**Scope.** One sub-phase per game, each independently shippable, in this order —
poker family first because they share the most with Phase 5:

1. Short Deck 2. Omaha 3. Zha Jin Hua 4. Niu Niu 5. Dou Di Zhu 6. Baccarat
7. Texas Cowboy 8. Cowboy & Beauty 9. Red Packet 10. Slot Machines 11. Lottery

Per game: re-skin the web felt; build the native felt; verify the rules against
the engine; confirm every string is in all 8 locales.

**Where.** `frontend/src/components/games/`, new `mobile/src/table/` felts,
engines in `game-server/src/games/`. `docs/ADDING_A_GAME.md` is the existing
guide.

**Done means.** Per game: playable start-to-finish on all three surfaces, rules
matching the engine, no untranslated strings.

**Depends on.** Phase 5.

**Not in scope.** New games. Eleven is enough.

---

### Phase 7 — Tutorial and Events

**Goal.** The two bottom-nav tabs we do not have at all: 教学 and 活动.

**Why.** They are not garnish — they are two of the reference's five tabs, and
one of them is a video platform. Discovered from the screenshots in §2.2.2 and
§2.2.3; this phase did not exist in the first draft of this plan, which is a fair
measure of how much a single screenshot is worth.

**Scope — Tutorial (教学).**
- Four sub-tabs: knowledge, tools, training, mine.
- Knowledge feed: numbered lessons, filterable by video vs article, each with
  timestamp, like count and view count.
- Video hosting and streaming, with thumbnails. **Decide build vs third-party
  early** — this is the cost driver in the phase.
- A CMS for publishing lessons, and who operates it.
- Article reader.
- **Tools** and **training** are unseen; capture them in Phase 0 before scoping.

**Scope — Events (活动).**
- Club-scoped events list: icon, title, CTA.
- The four seen: VIP group, big-hand reward, referral red packet, lucky dice.
  Each needs its own rules and payout definition — the list screen is the cheap
  part.
- Reuse what exists: `Jackpot` and `Vip` already cover some of this ground, and
  we already have a red-packet game engine.

**Where.** New sections in `frontend/src/pages/` and `mobile/src/screens/`.
Events may extend `Jackpot.tsx` and `Vip.tsx` rather than replacing them.

**Done means.** Both tabs are reachable and populated with real content on all
three surfaces — a player can watch a lesson through, and open an event and
understand what it pays.

**Depends on.** Phase 2 for the look; Phase 0 for the two unseen sub-tabs.
**Any event that pays out is money-touching — senior review** (iron rule 5).

**Estimate risk.** Highest of any phase here, because "video platform" and "four
promotion mechanics" are each larger than they look on a list screen. Do not
commit a date on this one until Phase 0 has captured tools and training.

---

### Phase 8 — Wallet, to the reference

**Goal.** Bring the wallet we already have up to what the references show.

**Why this shrank.** It was written as a fork — strip the wallet or keep it —
because §2.1 said WPK had no in-app money. It does. So does KKPoker, with
visible 充币 / 提币 buttons. This is now a re-skin and a gap-fill, not a
rebuild, and `financial-core` is not at risk.

**Scope.**
- Re-skin deposit and withdrawal to the reference's look.
- **Multi-currency.** WPK carries four balances — Diamond, Gold, USD, Points —
  and the header shows only the ones the current tab can spend. We have one. Ask
  the owner how many we want before building; this is a data-model change, not a
  screen.
- **Balance privacy:** the hide/show eye on the balance, as KKPoker has.
- Redeem, and a Backpack/Rewards equivalent if the owner wants the loyalty
  currency.

**Where.** `frontend/src/pages/Wallet.tsx`, `mobile/src/screens/WalletScreen.tsx`,
`financial-core/`.

**Done means.** A player deposits, plays, and withdraws, with the ledger
balancing — and the wallet looks like the reference doing it.

**Depends on.** The Wallet → Management screenshot (§4.1, point 2). If deposits
turn out to route through an agent there, this phase changes shape.

**Money-touching — senior review before merge** (iron rule 5).

---

### Phase 9 — Distribution

**Goal.** Real people can install it on real phones.

**Scope.**
- **Telegram mini app:** BotFather registration, HTTPS host, launch parameters,
  deep links into a club or table.
- **iOS + Android:** per §4.2. Store route → store listings, review submission,
  age rating, privacy labels. Sideload route → signing certificates, hosted
  `.ipa`/`.apk`, an update mechanism that does not depend on a store, and a
  documented plan for what happens the day a certificate is revoked.
- Wire whichever it is into the Phase 1 download page.
- Crash reporting and an update path on all three.

**Done means.** A person who has never seen the product installs it from the
website and reaches a table.

**Depends on.** §4.2 decided, Phase 1, Phase 5.

---

### Phase 10 — Hardening

**Goal.** Fit to run with real money and real players.

**Scope.** Load-test tables at real concurrency; reconnect/disconnect behaviour
mid-hand on mobile networks; locale sweep on real devices; accessibility pass;
security review of the gateway; fix the root `npm run verify` lint gate, which
is currently red on `main` and therefore not gating anything.

**Done means.** A sustained multi-table session with no desync, no lost chips,
and no crash.

---

## 6. Sequencing

```
Phase 0  Capture references  ── blocks everything visual, START TODAY
   │
   ├── Phase 1  Marketing website ─────────────┐   parallel, own deployable
   │                                           │
   └── Phase 2  Design system                  │
          │                                    │
          └── Phase 3  Splash · loading · login│
                 │                             │
                 └── Phase 4  Lobby and clubs  │
                        │                      │
                        ├── Phase 5  Texas felt│
                        │      │               │
                        │      └── Phase 6  The other 11 games
                        │                      │
                        └── Phase 7  Tutorial and Events   parallel with 5–6
                                      │
   Wallet screenshot ── Phase 8  Wallet ───────┤
   4.2 decision ── Phase 9  Distribution ─────┘
                                      │
                              Phase 10  Hardening
```

Phase 7 hangs off Phase 4, not off the felt work — it needs the club context and
the design system, but nothing from the table. It is the obvious candidate to run
in parallel with Phases 5 and 6 by a different person.

**Milestones.**

| # | Milestone | Phases | Demonstrates |
|---|---|---|---|
| M1 | References captured, decisions taken | 0 + §4 | We are building the right thing |
| M2 | Website live | 1 | Anyone can find and install it |
| M3 | Shell reskinned end-to-end | 2, 3 | The new look, on all three surfaces |
| M4 | Club loop works | 4 | Join a club, reach a seat |
| M5 | Hold'em plays everywhere | 5 | The product, minimally |
| M6 | Full catalogue | 6 | The product, fully |
| M7 | Tutorial and Events live | 7 | The other two tabs stop being empty |
| M8 | Wallet matches the reference | 8 | Deposit, play, withdraw |
| M9 | Installable by the public | 9 | Launch-ready |
| M10 | Hardened | 10 | Safe to run |

Phases 1 and 2 can run in parallel by different people. Phase 6's eleven games
can be split across developers once Phase 5 has set the pattern, and Phase 7 can
run alongside both.

---

## 7. What to do today

1. **Request WePoker club access.** It needs an agent to approve you, so it is
   the longest lead time in the plan and nothing about Phase 0 finishes without it.
2. **Install both apps** and start the Phase 0 capture.
3. **Put §4.1 and §4.2 in front of the owner.** They are business decisions, they
   block Phases 7 and 8, and 4.2 changes Phase 1. Everything above can proceed
   while they are considered — but not indefinitely.
