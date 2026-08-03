# 04 · Frontend Guide

The app lives in **`frontend/`**. It's a Vite + React 19 + TypeScript + Tailwind v4 single-page
app, built to run as a Telegram Mini App (and in a plain browser).

## Stack

| Concern | Choice |
|---------|--------|
| Build/dev | **Vite 6** (`npm run dev`, `npm run build`) |
| UI | **React 19** + TypeScript (strict) |
| Styling | **Tailwind CSS v4** (no `tailwind.config.js` — tokens live in CSS, see below) |
| Animation | **Motion** (`motion/react`) — the `motion.*` components + `AnimatePresence` |
| Icons | **lucide-react** |
| Routing | **react-router-dom v7** (`createBrowserRouter`) |
| State | **Zustand** (`src/store/`), **TanStack Query** for server data (installed, not yet used) |
| Telegram | `@telegram-apps/sdk-react` + `window.Telegram.WebApp`, wrapped in `src/lib/telegram.ts` |
| Deploy | **Netlify** (`netlify.toml`) |

## Source layout

```
frontend/src/
  main.tsx                 App entry: providers + RouterProvider, calls initTelegram()
  router.tsx               Routes. Tab pages nest under <AppShell/>; /table/:id is full-screen.
  index.css                THE design-token file — all brand colors live here (see below)
  vite-env.d.ts

  components/
    AppShell.tsx           Frame for tab pages: sticky Header + animated page area + BottomNav
    Header.tsx             Brand header (logo mark + wordmark image, theme toggle)
    BottomNav.tsx          4-tab bottom navbar (Lobby / Games / Wallet / Profile)
    GameTile.tsx           A game card with its own gradient identity + live player count
    ui/                    The reusable component kit (see below)
      Button, Card, Badge, Input, ListRow, Segmented, Sheet
    poker/                 The poker table screen's parts
      PlayingCard.tsx      One card; face-up/face-down; deal animation
      PlayerSeat.tsx       A seat: avatar, stack, bet chips, to-act ring, winner glow
      PokerTable.tsx       The felt + seat positioning + community cards + pot
      ActionBar.tsx        Hero's betting controls (fold/check/call/raise + slider)

  pages/
    Lobby.tsx              Jackpot hero, live-online band, hot + more games
    Games.tsx              Search + category filter + game grid + "coming soon"
    Wallet.tsx             Balance, deposit/withdraw, quick top-up, referral, activity (UI only)
    Profile.tsx            Identity, sign-in CTA, stats, menu (UI only)
    Table.tsx              Full-screen game table; runs the demo hand via useDemoHand()

  hooks/
    useDemoHand.ts         Drives the client-side demo poker hand (bots on a timer, next hand)

  lib/
    cards.ts               Card string format helpers ('As','Td'…) — matches the game-server
    handEval.ts            7-card hand evaluator (best 5 of 7), used by the demo engine
    pokerEngine.ts         The client-side demo Hold'em engine (deal→bet→showdown→payout)
    pokerBot.ts            Simple opponent AI for the demo table
    table.ts               View-model types the table components render
    games.ts               The game catalog (id, name, glyph, gradient, players, minBuy)
    telegram.ts            Typed wrapper over window.Telegram.WebApp (haptics, initData…)
    useTelegramBackButton.ts  Hook to wire the TG hardware back button
    cn.ts                  className joiner

  store/
    theme.ts               Zustand theme store (dark/light/system, persisted, stamps <html>)
```

## Branding lives in ONE place

**All brand colors are CSS variables in `src/index.css`.** There is no Tailwind config file
(Tailwind v4 reads tokens from CSS via `@theme inline {}`). To restyle the whole app you change
the variables in the `:root` block — e.g. `--brand`, `--brand-2`, `--accent`, `--bg`,
`--surface`, `--brand-gradient`. A light theme is defined under `:root[data-theme='light']`.

Brand image assets are in `frontend/public/brand/`:
- `logo.png` / `logo-icon.png` — the original source art (large, padded transparent canvas).
- `logo-wordmark.png` / `logo-mark.png` — **auto-trimmed** tight versions used in the header
  (the originals collapse at small sizes). If you regenerate them, trim the transparent padding
  with an alpha threshold (that's how these were made).

## The component kit (`components/ui/`)

Small, owned, MYPOKER-themed primitives — not a third-party library. Compose these; don't pull
in a UI framework. `Button` has `primary|secondary|ghost|danger` variants and fires Telegram
haptics; `Sheet` is a bottom sheet; `Segmented` is the animated tab switcher; etc.

## The poker table + demo engine (important context)

`pages/Table.tsx` renders a **fully playable Texas Hold'em hand** — but it runs entirely in the
browser on a **play-money demo engine**, with **no server involved**:

- `lib/pokerEngine.ts` shuffles, posts blinds, runs betting rounds, deals the board, and
  resolves showdown. It is **single-main-pot** (no side pots) on purpose — it exists to make
  the screen feel real, not to be authoritative.
- `lib/pokerBot.ts` gives the five opponents simple hand-strength-based decisions.
- `hooks/useDemoHand.ts` ties it together: bots act on a timer, hands roll into the next one,
  and it maps engine state → the view-model in `lib/table.ts` that the components render.

> **This is a stand-in.** Real-money hands must be driven by the **authoritative `game-server`
> over WebSocket** — the server owns the shuffle, the pot (including side pots), and settlement.
> Replacing the demo engine with the live feed is a task in [06-week-plan.md](06-week-plan.md).
> Keep the *components* (`PokerTable`, `PlayerSeat`, `ActionBar`, `PlayingCard`) — they render a
> view-model and don't care where it comes from. Swap the *source* (`useDemoHand`), not the UI.

The card string format in `lib/cards.ts` (`'As'`, `'Td'`, `'9c'`) deliberately matches the
game-server, so real hand data drops in without translation.

## Commands

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build → dist/
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```
