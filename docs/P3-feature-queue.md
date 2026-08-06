# MYPOKER — P3 Feature Queue (do these in order)

**For:** the third developer (everything that is **not** the Texas table and **not** the wallet).
**How to use:** work top to bottom. One item = one branch = one PR to `main`. Don't jump ahead —
each phase is ordered so the thing you build next can lean on what you just built.

> Texas Hold'em table = **P1**. Wallet (full real-money) = **P2**. The other **games**
> (Baccarat, Niu Niu, Red Packet, Dou Di Zhu, San Zhang, Short Deck, Omaha, Cowboy & Beauty,
> Lottery, Slots) come **after** this whole list is done — don't start them yet.

---

## ⛔ Follow these documents — strictly (owner's instruction)

Build to the spec, not to your own idea of the feature. If in doubt, ask Victor — **do not guess.**

1. **`PROJECT_PLAN.md`** (repo root) — the owner's plan, milestones, and the "gate" for each
   week. This is the schedule you build against.
2. **The specs** (repo root `.docx`), in this layered order — the source of truth for how every
   feature must behave:
   - `FairPlay_v5.9…` (base)
   - `FairPlay_v5.9.1_CommitReveal_Merkle_EN.docx` (fairness commit-reveal)
   - `FairPlay_v6.0_UltraFair_EN.docx` (latest fairness model — **wins on any conflict**)
3. **`docs/handoff/04-frontend-guide.md`** — how the app is built (branding lives in one CSS
   file, the component kit, the table pattern). Match these conventions.
4. **`docs/handoff/07-git-workflow.md`** — branch → PR → **Victor reviews & tests** → merge.
   Nothing reaches `main` without his review.

**Precedence when they disagree:** Victor's word → `PROJECT_PLAN.md` + the specs → the handoff
docs → your own preference.

**Iron rules (never break — a PR that breaks one is rejected):** money moves only through the
server's ledger, never written on the client; **RiskFactor is never shown in the UI**;
reputation/anti-bot never block a withdrawal; Platform and League stay isolated; amounts are
integers, never floats. Full list in `docs/handoff/01-project-overview.md`.

**Every PR must say:** what changed, how to test it, screenshots for any UI, and — if it touches
money — tag it `[money]`.

---

## PHASE A — Foundations (build first; everything below reuses these)

1. **Preloader / splash screen** — a branded boot screen while the app loads.
   _Done when:_ app open shows the MYPOKER splash, then fades into the lobby; no white flash.
2. **Toast system** — one global success/error toast used everywhere.
   _Done when:_ any screen can fire a toast; used by at least one real action.
3. **States kit** — reusable `Skeleton`, `EmptyState`, and `ErrorState` components.
   _Done when:_ all three exist in `components/ui/` and render in Storybook/a demo screen.
4. **Connection handling** — a "reconnecting / offline" banner + retry on network errors.
   _Done when:_ killing the network shows the banner; restoring it recovers without reload.
5. **Shared data layer** — confirm/finish the API client + TanStack Query setup + `VITE_API_URL`
   config (some may already exist from the session work — reuse, don't duplicate).
   _Done when:_ a query hook fetches a real backend endpoint and renders loading→data→error.
6. **Localization scaffold (EN / 中文)** — set up i18n and wrap UI strings from here on.
   _Done when:_ a language toggle switches at least the shell + one screen between English and
   Chinese; new screens use the i18n strings, not hardcoded text.

## PHASE B — Put real data into the screens that already exist

7. **Profile — real stats** (hands, win-rate, biggest win, VIP tier) from the server.
   _Done when:_ signed in, Profile shows real numbers; signed out, it degrades cleanly.
8. **Lobby — real data:** live player counts, **jackpot display**, **winner ticker**, filters.
   _Done when:_ lobby reflects the server; with the backend down it shows loading→fallback.
9. **Data tab** — game history / records / personal stats.
   _Done when:_ the tab lists real past hands/results with paging and an empty state.
10. **Settings — full page:** language switch, sound on/off, notifications, account, and links to
    fairness verification & support (theme is already wired).
    _Done when:_ every toggle persists to the account when signed in.

## PHASE C — New feature screens (from the spec)

11. **Fairness verification page** — the real **6-step verifier** reading the round's commit/seed
    data. (Follow the v6.0 spec exactly.)
    _Done when:_ pasting/opening a finished hand runs all 6 steps and shows pass/fail.
12. **Public fairness / RTP feed** — theoretical + lifetime-actual payout rate, per-round
    rule-version stamp. (Owner-added scope — see PROJECT_PLAN.)
    _Done when:_ each game shows its published rate + sample size, read from the server.
13. **VIP page** — 5 tiers, progress by effective volume, perks, Pro Tracker, Black Gold.
    _Done when:_ the page shows the player's tier, progress to next, and each tier's benefits.
14. **Reputation** — the 500→700 score display (must **never** imply it can block funds).
    _Done when:_ score shows on Profile with its band; no "blocked" language anywhere.
15. **Jackpot UI** — 4-tier display, Grand Saturday window, history, and a win animation.
    _Done when:_ tiers + current amounts show; a jackpot event plays its animation.
16. **Insurance UI** — show/skip rules (2-all-in only). **RiskFactor must never appear.**
    _Done when:_ the insurance prompt follows the spec's show/skip conditions.
17. **Alliance (League & Club)** — creation, private rooms, dual-wallet context isolation.
    _Done when:_ a league context never shows platform tables/wallet and vice-versa.
18. **Agent Center** — 2-level agents, sub-rates, per-hand commission, 4-tab dashboard,
    referral links. (Agents must **never** see player balances.)
    _Done when:_ the 4 tabs render real agent data; a referral link copies and works.
19. **Onboarding / first-open** — a lightweight welcome + new-player path on first launch.
    _Done when:_ first launch shows it once; it doesn't reappear after.
20. **In-app notifications** — results, deposits, promos.
    _Done when:_ a notifications list + unread indicator work off real events.

## PHASE D — In-table social (after the Texas table is live — coordinate with P1)

21. **In-table chat** — isolated namespace, XSS-safe.
    _Done when:_ messages send/receive at a table; a chat error can't affect the game.
22. **Spectator mode** — 5-second delay, server-enforced.
    _Done when:_ a spectator sees the table on delay and cannot act.
23. **Peer Challenge** UI.
    _Done when:_ the challenge flow matches the spec.
24. **Voice chat (Agora)** — **confirm scope with Victor first** (backend not built yet).

## PHASE E — Polish pass (across the whole app)

25. **Animations/graphics:** card deal, **chips fly to pot**, winner celebration, jackpot burst,
    seat countdown rings.
26. **Sound effects** — deal, chips, win, timer, check/fold (respect the Settings toggle).
27. **Assets** — avatars, chip art, felt texture, game icons, MYPY mascot placements.
28. **Responsive pass** — small phones + safe-area insets, no horizontal scroll.
29. **Accessibility** — visible focus states, contrast, `prefers-reduced-motion`.
30. **Full localization translation** — complete the EN / 中文 strings everywhere.
31. **Formatting** — consistent currency/number display, tabular digits.

## PHASE F — Ship it (shared milestones — coordinate; some blocked on Victor)

32. **Device / root detection** + anti-bot client hooks. **[doc]**
33. **Optimistic-UI** (<50ms action feedback) + delta updates. **[doc]**
34. **Deployment** — Heroku ×2 + Netlify + MongoDB Atlas + **password-gated, testnet** staging.
    _Blocked on Victor providing the accounts + bot token — ask early._
35. **Telegram Mini App build.**
36. **iOS + Android** (React Native — Bare Workflow) + device/root detection. **Week 10 milestone.**

> **Admin / ops panels** (platform + league admin, withdrawal review queue) are in the spec but
> likely owner-side — **confirm with Victor** before P3 picks them up.

---

### When this list is done
All non-game features are shipped. Then the whole team (P1, P2, P3) turns to the **remaining
games**, one at a time, on the table pattern P1 established.
