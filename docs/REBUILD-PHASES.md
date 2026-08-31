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
nothing else — no navigation, no layout, no copy. So:

- What is in §2 comes from **public documentation and reporting about** the two
  platforms, not from reading the sites.
- **Nothing about `hhpoker777.com`'s actual visual design has been observed.**
  Layout, spacing, colour and type — the entire reason it is our UI reference —
  are unrecorded. §2.2 is therefore nearly empty, honestly.

**This is the first thing that needs fixing, and it needs a person, not a
fetch.** Someone has to install both apps and walk them. Until that happens the
UI phases below are structured but not specified: they say *what screen*, not
*what it looks like*.

**What to capture, per screen** (both apps): splash, loading, login/signup,
lobby, club list, club interior, table list, the felt itself, the action bar,
wallet/chips, profile, settings.

- A screenshot of each, iPhone and Android
- A screen recording of: cold start → login → enter a club → sit → play a hand →
  leave
- For each: the colour behind it, the corner radius, the spacing rhythm, where
  the primary action sits, what the type scale looks like

That capture is **Phase 0**, and it blocks the UI phases.

---

## 2. What the references are

### 2.1 wpk.com (WePoker / 微扑克) — the functionality brief

A **club-based** poker platform. The structure, which is the important part:

- Sign-up is **email + password, no ID check**.
- You cannot just play. You **join a club**, and to join you **apply to an
  agent**.
- The **agent handles all deposits and withdrawals**, and runs the tables.
- Clubs group into **unions**. The club/union/agent you belong to determines
  your experience.
- Strongest in China, Taiwan, Vietnam and South-East Asia.

**The single most consequential fact for us:** WePoker carries no gaming licence
because *there are no financial facilities in the app at all*. Money moves
between player and agent **outside** the software. The app moves chips; it never
moves money.

We are built the opposite way. See §4.1 — this is the decision everything else
waits on.

### 2.2 hhpoker777.com (HHPoker / 德扑圈) — the UI brief

What is established:

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

**Everything else about this site — the actual look — is unrecorded.** See §1.

---

## 3. What we already have

This is not a rebuild from zero, and any plan that treats it as one will be
wrong about the cost. Audit as of today:

| Piece | State | Under the new direction |
|---|---|---|
| `game-server` | 12 games, live WebSocket tables, provably-fair shuffle, gateway/auth/admin | **Keeps.** Direction changes clients, not the engine. |
| `financial-core` | Ledger, settlement, TRC-20 USDT deposits + withdrawals, notifications | **Blocked on §4.1.** May become far smaller — or move out of the app entirely. |
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

### 4.1 Does money stay inside the app?

**The conflict.** wpk.com is the functionality brief, and its defining property
is that *money is not in the app*. Agents settle with players outside it. We
currently have the exact opposite: an on-chain USDT deposit watcher, a
withdrawal pipeline, and a full ledger, all in-product.

**Why it cannot be deferred.** It determines whether `financial-core` is central
or nearly deleted; whether we need a gaming licence; whether the store route in
§4.2 is even open; and what the Wallet screen is for. Phases 7 and 8 cannot be
scoped until it is answered.

**Options.**

- **(A) Follow WePoker.** Chips only in-app; agents settle outside. Lowest legal
  exposure, opens the store route, and is what the brief actually points at.
  Cost: the deposit/withdrawal work is stood down.
- **(B) Keep our wallet.** We are then a licensed-gambling product, not a WePoker
  clone. Cost: licensing, and the stores are effectively closed (§4.2).
- **(C) Split.** Chips-only build for the stores; full-wallet build elsewhere.
  Cost: two builds, two review paths, a permanent source of drift.

**Recommendation: (A)**, because it is what the reference does and it is the only
option where "iOS and Android" means the stores. But this is a business call.

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

**This must be decided before Phase 8, and it changes Phase 1.**

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

**Why.** §1 — we have not seen hhpoker777's interface. Every UI phase below is
currently a placeholder without this.

**Scope.**
1. Install WePoker and HHPoker on a real iPhone and a real Android device.
2. Screenshot every screen listed in §1, both platforms.
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
- Support/contact, and whatever legal pages the §4.1 answer requires.
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

**Depends on.** Phase 3. §4.1 for whether the agent moves money or only chips.

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

### Phase 7 — Money, per the §4.1 decision

**Goal.** Implement the chosen money model.

**Why.** Deliberately late: it is the decision with the widest blast radius, and
everything above is unaffected by which way it goes.

**Scope — if (A) chips-only.** Strip in-app deposit/withdrawal from the clients;
Wallet becomes chips + club balance + history; agent grant/settle flows become
the only way chips move; decide what remains of `financial-core`.

**Scope — if (B) keep the wallet.** Re-skin the existing deposit/withdrawal flows
to the reference; begin licensing; drop the store route in Phase 8.

**Where.** `frontend/src/pages/Wallet.tsx`, `mobile/src/screens/WalletScreen.tsx`,
`financial-core/`.

**Done means.** A player can obtain chips, play, and cash out by whichever route
was chosen, with the ledger balancing.

**Depends on.** §4.1. **Money-touching — senior review before merge** (iron rule 5).

---

### Phase 8 — Distribution

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

### Phase 9 — Hardening

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
Phase 0  Capture references        ── blocks everything visual, START TODAY
   │
   ├── Phase 1  Marketing website ──────────────┐  (parallel, own deployable)
   │                                            │
   └── Phase 2  Design system                   │
          │                                     │
          └── Phase 3  Splash · loading · login  │
                 │                              │
                 └── Phase 4  Lobby and clubs   │
                        │                       │
                        └── Phase 5  Texas felt │
                               │                │
                               └── Phase 6  The other 11 games
                                      │
        §4.1 decision ── Phase 7  Money ────────┤
        §4.2 decision ── Phase 8  Distribution ─┘
                                      │
                               Phase 9  Hardening
```

**Milestones.**

| # | Milestone | Phases | Demonstrates |
|---|---|---|---|
| M1 | References captured, decisions taken | 0 + §4 | We are building the right thing |
| M2 | Website live | 1 | Anyone can find and install it |
| M3 | Shell reskinned end-to-end | 2, 3 | The new look, on all three surfaces |
| M4 | Club loop works | 4 | Join a club, reach a seat |
| M5 | Hold'em plays everywhere | 5 | The product, minimally |
| M6 | Full catalogue | 6 | The product, fully |
| M7 | Money model live | 7 | Players can actually play for something |
| M8 | Installable by the public | 8 | Launch-ready |
| M9 | Hardened | 9 | Safe to run |

Phases 1 and 2 can run in parallel by different people. Phase 6's eleven games
can be split across developers once Phase 5 has set the pattern.

---

## 7. What to do today

1. **Request WePoker club access.** It needs an agent to approve you, so it is
   the longest lead time in the plan and nothing about Phase 0 finishes without it.
2. **Install both apps** and start the Phase 0 capture.
3. **Put §4.1 and §4.2 in front of the owner.** They are business decisions, they
   block Phases 7 and 8, and 4.2 changes Phase 1. Everything above can proceed
   while they are considered — but not indefinitely.
