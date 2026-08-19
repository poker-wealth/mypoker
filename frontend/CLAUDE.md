# frontend — the Mini App

React 19 + Vite + Tailwind v4. Mobile-first, runs inside a Telegram WebView. See the root `CLAUDE.md` for the iron rules.

## Design system — not suggestions

**Tokens only** (defined in `src/index.css`): `bg-bg`, `bg-surface`, `bg-surface-2`, `text-text`, `text-dim`, `text-brand` (violet), `text-accent` (cyan), `border-border`, `text-danger`, `bg-danger/10`. No raw hex.

**Jackpot gold (`text-jackpot`) is for jackpots.** Never admin. It has crept back in twice — gold reads as celebration on the one screen whose whole purpose is that money is leaving.

## Primitives, and their actual contracts

Reuse `src/components/ui/`. The two that are misremembered constantly:

- **`Input`** — `onChange: (value: string) => void`. It hands you the **string**, not the event.
- **`Badge`** — tones are `brand | success | accent | neutral | warn`. There is **no `danger` tone**; `warn` already resolves to the danger colour.

`Sheet` takes `elevated` when it must stack above another open sheet — sheets are siblings in one stacking context, so z-index beats DOM order and a plain nested sheet leaves the one underneath bright and clickable.

**Money confirmations go through `useConfirmSheet`**, never `window.confirm` / `window.prompt`. Native dialogs are unreliable in a Telegram WebView, and a confirmation that never opens means a two-person rule that cannot be exercised.

## Three states, always

Anything that fetches needs `Skeleton` (loading), `EmptyState`, `ErrorState`. An empty screen and a broken screen must not look alike.

## i18n — eight locales, no exceptions

`src/i18n/locales/{en,zh,ja,ko,th,vi,hi,id}.json`. A key missing anywhere renders **raw** on screen; that has shipped more than once, including on money notifications.

`npm run build` runs `check:locales` and will reject an incomplete set. Write real translations — an English placeholder in `zh.json` is a bug, not a TODO, on a page about trust.

## Honesty rules

- Never render an invented figure. No sample data, no fallback player counts, no "status" numbers. An em dash beats a made-up number.
- A disabled control needs a reason the user can read, and a control only some people can use does not belong where everyone sees it.
- Don't promise what the backend does not do. Features that are not wired say so.

## Telegram reality

Runs in a WebView: `localStorage` persists, `window.prompt` does not work reliably, and the app must load over HTTPS. `getUserMedia` needs a secure context — `localhost` counts, a LAN IP does not, so mic features cannot be tested over plain http on a phone.

## Verifying

```bash
npx tsc -b && npx eslint src && npx vite build && npx vitest run
```

`npm run verify` at the repo root does **not** cover this package. `build` also runs `check:no-localhost`, which rejects a bundle with a localhost API URL baked in — put dev API URLs in `.env.development.local`, not `.env.local`, since Vite loads the latter in production builds too.

Known: **16 pre-existing eslint `any` errors** in `src/components/games/`. Not yours.
