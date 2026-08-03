# 06 · Week Plan (Mon → Sat)

This is your work for the coming week. We work **Monday to Saturday**. The theme of the week:
**turn the demo into a real, connected product** — backend running, Telegram login, real
wallet, live game feed — while building out the remaining game screens in parallel.

Every task below lists **sub-tasks**, **acceptance criteria** (how Victor knows it's done),
**depends on**, and **blockers**. One task ≈ one branch ≈ one PR. See
[07-git-workflow.md](07-git-workflow.md).

## The split

- **Samuel — "Make it real" track:** get the backend running & deployed, Telegram auth, real
  wallet wiring, and the live game-server connection replacing the demo engine.
- **Esther — "Breadth & polish" track:** the shared data layer, the remaining game table
  screens, and wiring the lobby/profile to real data.

They're arranged so you rarely touch the same files. **Day 1 you work together** to build the
shared foundation both tracks stand on.

## Dependency map (read this before starting)

```
Mon (both): run stack locally  ─►  shared API client + session store  ─► unblocks everything
                                         │
Samuel:  auth server+client ─► real wallet ─► WS game client ─► live table replaces demo
Esther:  query/data hooks   ─► table template ─► game screens ─► lobby/profile real data
```

- **Auth is the gate** for real wallet and real profile. Samuel builds it Day 2; Esther's
  real-data wiring (Day 5) depends on it existing.
- **Deployment is blocked on Victor** providing the Netlify / Heroku / MongoDB Atlas accounts
  and the Telegram bot token (from @BotFather). Ask for these **on Monday** so they're ready
  when Samuel needs them. Until then, everything runs and is tested **locally**.

---

# MONDAY — both of you, together

### M1. Get the whole stack running locally
**Sub-tasks**
- [ ] Read handoff docs 01–05. Skim `PROJECT_PLAN.md`.
- [ ] Install everything: from repo root, `npm run install:all`.
- [ ] Start a local MongoDB **replica set** (financial-core uses transactions, which need a
      replica set — see [03-getting-started.md](03-getting-started.md)).
- [ ] Run `financial-core` and `game-server` locally; confirm both boot.
- [ ] Run the test suites: `npm test` from root (or per package). Confirm green.
- [ ] Run the frontend: `npm run dev`, open `http://localhost:5173`, click through all four
      tabs and play a hand at a table.

**Acceptance:** both developers can, on their own machine, boot backend + frontend, see tests
pass, and play a demo hand. Post a screenshot in the team channel.
**Blockers:** none (all local).

### M2. Build the shared foundation (pair on one branch: `feature/frontend-api-foundation`)
This is what both tracks build on, so do it together and get it right.
**Sub-tasks**
- [ ] Add a frontend env config for the API base URL: `VITE_API_URL` (default
      `http://localhost:<game-server port>`), read in a small `src/config.ts`. Document it in
      `frontend/.env.example`.
- [ ] Create `src/api/client.ts` — a thin `fetch` wrapper that adds the base URL, JSON
      headers, and (later) the auth token; throws typed errors.
- [ ] Wire **TanStack Query** in `main.tsx` (the `QueryClientProvider` — it's already a
      dependency). Add a `src/api/` folder convention for query/mutation hooks.
- [ ] Create `src/store/session.ts` (Zustand) — holds `{ token, user, status }`, persisted;
      empty for now (auth fills it Day 2).
- [ ] Confirm the exact **client-facing API service + base path** with Victor / doc 02 (which
      service is the gateway the app talks to — game-server HTTP). Write it in `config.ts`.

**Acceptance:** frontend builds; a trivial query hook can hit a real backend health endpoint
and render the result; `session` store exists and persists. One PR, reviewed by Victor.
**Blockers:** needs the backend running (M1).

---

# SAMUEL — "Make it real"

### TUE — S1. Backend runs end-to-end + deploy to staging
`feature/backend-staging`
**Sub-tasks**
- [ ] Document the exact local run recipe for both services in a scratch note (feed corrections
      back into doc 03).
- [ ] Confirm the **client-facing HTTP + WebSocket surface** of `game-server` (routes, WS
      message types) — list them; you'll consume these all week.
- [ ] **When Victor provides accounts:** create the **MongoDB Atlas** M0 cluster (it's a replica
      set — required). Put the connection string in Heroku config, never in git.
- [ ] Deploy `financial-core` and `game-server` as **two Heroku apps**. Set all env/secrets in
      Heroku config vars. Point them at Atlas.
- [ ] Deploy the frontend to **Netlify** from `frontend/` (`netlify.toml` already configured);
      set `VITE_API_URL` to the Heroku game-server URL.
- [ ] **Password-gate** the staging frontend and confirm it's **testnet/test-money only**.

**Acceptance:** the staging URL loads the app; the frontend can reach a backend health endpoint
over the network; secrets are only in Heroku/Netlify config, not in git. Demo table still works.
**Depends on:** M1, M2. **Blockers:** ⚠️ Victor must provide Netlify + Heroku + Atlas access
and the bot token. Do the local + documentation parts first if creds are late.

### WED — S2. Telegram authentication (server + client)
`feature/telegram-auth`
**Sub-tasks**
- [ ] **Server:** add a `POST /auth/telegram` endpoint on the game-server gateway that takes
      Telegram `initData`, **validates the HMAC signature using the bot token** (reject invalid
      or stale), extracts the Telegram user, **creates or looks up a player account**, and
      returns a **session JWT** + the user profile.
- [ ] Server: add auth middleware that verifies the JWT on protected routes; unauthenticated
      requests to protected routes get 401.
- [ ] **Client:** on app open, read `initData` via `lib/telegram.ts`, call `/auth/telegram`,
      store `{token,user}` in `src/store/session.ts`, and attach the token in `api/client.ts`.
- [ ] Client: handle the **browser (non-Telegram) case** gracefully — show a "Open in Telegram"
      state instead of crashing (a dev bypass behind an env flag is fine for local testing).
- [ ] Profile page: replace "Guest Player" with the real Telegram name/avatar when signed in;
      wire the "Continue with Telegram" button to the flow.

**Acceptance:** opening the Mini App in Telegram signs you in automatically and Profile shows
your real name; a tampered/blank `initData` is rejected by the server; the token persists across
reloads. **Depends on:** M2, bot token. **Blockers:** bot token from Victor. `[security]` — flag
in the PR; Victor tests the reject path.

### THU — S3. Real wallet (testnet)
`feature/wallet-live`
**Sub-tasks**
- [ ] Confirm the wallet endpoints on the gateway (balance, deposit address, withdraw request),
      backed by `financial-core` — **never write balances from the client**; all money moves
      server-side via `transfer()`/ClearingRules (iron rule #1).
- [ ] Wallet page: fetch and show the **real balance** (Available / In-play) via a query hook.
- [ ] **Deposit:** show the real testnet deposit address / flow returned by the server (QR +
      copyable address). No client-side crediting.
- [ ] **Withdraw:** submit a withdrawal **request** to the server (enters the existing 5-state
      withdrawal flow); show its pending status. Reputation/anti-bot must **not** block it
      (iron rule #3).
- [ ] Show real **recent activity** (ledger entries) in the activity list.
- [ ] Keep the "test funds only" notice until the security review.

**Acceptance:** balance reflects the server; a testnet deposit credits after confirmation; a
withdrawal request appears in the server's review queue; no balance is ever computed on the
client. **Depends on:** S2 (auth). **Blockers:** none once auth is in. `[money]` PR — Victor
tests deposit + withdraw against testnet.

### FRI–SAT — S4. Live game connection replaces the demo engine
`feature/live-table`
**Sub-tasks**
- [ ] Create `src/api/gameSocket.ts` — a WebSocket client for the game-server: connect with the
      auth token, handle the handshake, subscribe to a table, send actions, receive state.
- [ ] Create `src/hooks/useLiveHand.ts` — the **same shape as `useDemoHand`** (returns the
      `TableState` view-model + `heroAct`), but fed by the socket. **Reuse the existing table
      components unchanged** (`PokerTable`, `PlayerSeat`, `ActionBar`, `PlayingCard`).
- [ ] Map server hand/seat/board messages → the `lib/table.ts` view-model. Handle to-act,
      timers, folds, all-in, showdown, and the server-declared winner/settlement.
- [ ] Switch `pages/Table.tsx` to `useLiveHand` for real tables; keep `useDemoHand` available
      behind a `?demo=1` flag so we never lose the offline demo.
- [ ] Handle disconnect/reconnect (the server already has pause/reconnect rules — respect them
      on the client: show "reconnecting", resync on reattach).
- [ ] Verify the **provably-fair** data is surfaced (the commit/seed info the server sends) so
      the future verification page can use it.

**Acceptance:** joining a real table plays a **server-authoritative** hand end-to-end — deal,
betting, showdown, and **settlement through financial-core** (chips change via the ledger, not
the client). Disconnect/reconnect recovers. The demo still works at `?demo=1`. **Depends on:**
S1 (backend reachable), S2 (auth). `[money]` PR — this is the real thing; Victor tests a full
hand and confirms the ledger moved.

---

# ESTHER — "Breadth & polish"

### TUE — E1. Data layer + lobby from real-ish data
`feature/lobby-data`
**Sub-tasks**
- [ ] Using the M2 query layer, create `src/api/lobby.ts` with query hooks for the game list /
      table list / player counts (against the game-server lobby endpoints; confirm them with
      Samuel/doc 02).
- [ ] Refactor `pages/Lobby.tsx` and `pages/Games.tsx` to render from a query hook instead of
      the hardcoded `lib/games.ts` — but **keep a static fallback** so the UI still renders if
      the endpoint isn't ready (loading + error + empty states).
- [ ] Add proper **loading skeletons** and an **error state** to both pages (reusable
      `Skeleton` component in `components/ui/`).

**Acceptance:** with the backend up, the lobby shows server-provided games/counts; with it
down, it shows a clean loading→fallback, never a blank/crash. **Depends on:** M2. **Blockers:**
lobby endpoints existing (coordinate with Samuel S1); use the static fallback until then.

### WED — E2. Reusable table template + first two card games
`feature/card-game-screens`
**Sub-tasks**
- [ ] Extract the shared bits of the poker table into a reusable **table scaffold** (top bar,
      felt area, result banner, action dock) so each game screen fills in only its middle.
- [ ] Build the **Baccarat** screen (player/banker/tie layout, card reveal, result) as a
      presentational screen driven by a view-model (no real socket yet — a local mock feed like
      the demo, clearly marked, so it's visually complete).
- [ ] Build the **Niu Niu** screen (banker + players, hand reveal, 牛 result).
- [ ] Route `/table/:id` to the right screen by game id (`lib/games.ts` category/id).

**Acceptance:** navigating to Baccarat and Niu Niu from the lobby opens complete, animated,
branded screens that visually play a round (on a local mock). Reviewed for look/feel by Victor.
**Depends on:** M2. **Blockers:** none (mock-fed, wired to live data later).

### THU — E3. Two more game screens
`feature/more-game-screens`
**Sub-tasks**
- [ ] Build the **Dou Di Zhu** screen (3 players, bidding, hand of cards, play area).
- [ ] Build the **Red Packet (Minesweeper)** screen (the grid, reveal, bet flow).
- [ ] Ensure all game screens share the scaffold from E2 and the card components from
      `components/poker/`.

**Acceptance:** Dou Di Zhu and Red Packet open as complete, animated screens on a local mock.
Consistent with the other tables. **Depends on:** E2. **Blockers:** none.

### FRI — E4. Profile + settings on real data
`feature/profile-live`
**Sub-tasks**
- [ ] Wire the **Profile** page to the signed-in user (name, avatar, VIP tier) from the session
      store / a profile query. Show real stats if the endpoint exists; otherwise hide, don't
      fake.
- [ ] Build a real **Settings** screen (theme is already wired; add language stub, sound toggle,
      links to fairness verification & support) saved to the account when signed in.
- [ ] Empty/signed-out states: if not in Telegram, Profile shows the sign-in CTA cleanly.

**Acceptance:** signed in, Profile reflects the real account; settings persist; signed out, it
degrades cleanly. **Depends on:** S2 (auth) — coordinate; if auth slips, do the presentational
parts and wire the data behind it. **Blockers:** auth landing.

### SAT — E5. Polish pass + states + buffer
`feature/ui-polish`
**Sub-tasks**
- [ ] Global **toast** system (success/error) and use it for wallet/auth/table actions.
- [ ] Consistent **loading** and **error** states across all data screens.
- [ ] Onboarding/first-open: a lightweight welcome sheet on first launch (uses the `Sheet`
      component).
- [ ] Accessibility/responsiveness sweep on small phones; fix any overflow.
- [ ] Buffer for review fixes from the week's PRs.

**Acceptance:** the app feels finished — no dead buttons that give no feedback, no raw error
crashes, clean first-open. **Depends on:** the week's screens. **Blockers:** none.

---

## Definition of done for the week

By Saturday, on **staging** (or locally if deployment creds were late):
- Telegram login works and creates a real account.
- The wallet shows a real balance and can request a testnet deposit + withdrawal.
- At least the **Hold'em** table plays a **server-authoritative** hand with real settlement.
- **Baccarat, Niu Niu, Dou Di Zhu, Red Packet** have complete screens (live-wiring can follow).
- Lobby/Profile render real data with proper loading/error states.
- Every change went through a **PR reviewed and tested by Victor**; `main` is always buildable.

## If you're blocked

- **Waiting on Victor** (creds, a decision, a review): say so in the team channel with exactly
  what you need, then pick up the next task that doesn't depend on it (there's always a
  local/presentational part you can do first).
- **Waiting on each other:** Esther's screens are mock-fed by design so they don't block on
  Samuel's backend; Samuel's backend work doesn't block on Esther's screens. Only the *final
  wiring* joins the two — schedule that late in the week.
