# Samuel — task list

Your focus is the things around the games: money notifications, frontend polish, the admin screens, and tests. These are independent of the game work, so you can start straight away off `main`.

**Work in this order. Ask questions any time, and read the relevant code until you understand it before you build — that's expected, not a delay.**

## Read first
- `financial-core/src/deposit/deposit-credit.ts` — where a deposit is credited (money in).
- `financial-core/src/withdrawal/withdrawal-state-machine.ts` — the withdrawal states (money out).
- `financial-core/src/notifications/notification-store.ts` — how the platform already records notifications. Email sits **next to** this, triggered by the same events.

---

## 1. Email notifications for money in and out — your first task

We send email with **Nodemailer**. It isn't installed yet — add `nodemailer` and `@types/nodemailer` to `financial-core`.

**Where your code goes:** a new folder `financial-core/src/notifications/email/`:
- `transport.ts` — build one Nodemailer transport from SMTP env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`). **Never hard-code credentials** — the SMTP account is an owner dependency, ask for it. Export a single shared transport (don't create one per send).
- `templates.ts` — one function per event that returns `{ subject, html, text }`. See the template rules below.
- `send-email.ts` — `sendEmail(to, template)` that uses the transport, and **dedupes on the notification event id** so a retry never sends a second email for the same deposit/withdrawal.

**Where you trigger it:**
- **Money in** — in the deposit credit path (`deposit-credit.ts`), after the credit is written, send the "deposit received" email.
- **Money out** — in the withdrawal state machine, send on **requested** (a receipt) and on **sent/confirmed** (it's on its way). 
- Hook into the same place the in-app notification already fires — don't build a parallel event system.

**Template design:**
- Email HTML is **not** app HTML. Use a **table-based layout with inline styles** — email clients don't support fl[ex]/grid/external CSS reliably. No Tailwind classes in the email.
- Match the brand but keep it simple: near-black background `#0d0d1a`, a centered card on `#171728`, violet accent `#bb5cf6`, cyan `#00d4ff` for a secondary accent, white text, dim `#9aa0b4` for labels. The MYPOKER wordmark at top, the tagline "Fair. On-Chain. Always." small in the footer.
- Structure: **wordmark → one-line heading → the amount, large and bold → a details table (amount, network/tx hash, time, status) → a short footer** (support link, "you're receiving this because…"). 
- Always include a **plain-text version** (the `text` field) — some clients and all previews use it.
- Write one shared layout helper (header/footer/card) and let each event fill the middle, so deposit and withdrawal emails look like siblings.
- Money wording must be exact and never alarming: "₮20.00 received", "Withdrawal of ₮20.00 sent". Use the same decimal string the ledger holds — never reformat with floats.

Money-touching hooks are senior-reviewed before merge.

---

## 2. Frontend polish
- **Phone / OTP sign-in:** today the "Phone" toggle is a relabeled email form with no real OTP. Either build the real OTP flow or remove the phone option so nothing misleads a user.
- **Lobby:** remove the hardcoded `SAMPLE_TABLES` fallback (dead table ids) and the invented "status" dollar figure; build the "Create Private Table" flow; make the filter button work.
- **Dead controls:** the Profile "Support" row and the table sound button do nothing — wire or remove them. Make the Games grid reflect real availability instead of a static list.

---

## 3. Admin UI

The app is a mobile-first Telegram Mini App. Build the admin area to the **same design system** — don't invent a new look:
- **Styling:** Tailwind v4 with the tokens in `frontend/src/index.css`. Use `bg-bg` (page), `bg-surface` / `bg-surface-2` (cards), `text-text` / `text-dim`, `text-brand` (violet `#bb5cf6`), `text-accent` (cyan `#00d4ff`), `border-border`. **Reserve jackpot gold for jackpots — never use it in admin.**
- **Primitives:** reuse `src/components/ui/` — `Card`, `ListRow`, `Segmented` (tab bar), `Sheet` (bottom sheet for actions/confirms), `Button`, `Badge`, `Switch`, `Input`, `Skeleton`, `EmptyState`, `ErrorState`, `Toaster` (toasts). Icons from `lucide-react`.
- **Animation:** use `motion` (already a dependency). Keep it restrained — admin is about clarity, not flash. Allowed: list items fade+slide in with a small stagger, tab content cross-fades, the action sheet slides up (Sheet already does this), and overview metrics count up once on load. **Respect `prefers-reduced-motion`.**

**Layout / nav / where things go:**
- Route it at `/admin`, **guarded to admins** (check with the senior on the admin flag/role). It is **not** a product tab — do **not** add it to `BottomNav`.
- Build an **`AdminShell`** (its own shell, separate from the player `AppShell`): a top `Header` reading "Admin", then a **`Segmented` tab bar across the top** for the sections. On wide screens (≥ `md`) you may add a **left sidebar** with the same items and hide the top Segmented; on mobile use only the top Segmented. Admin may use a wider max-width than the 520px player shell.
- Section order in the tab bar: **Overview · Withdrawals · Players · Leagues · Alerts.**
- Every screen has the three states: `Skeleton` while loading, `EmptyState` when there's nothing, `ErrorState` on failure. Confirm every money action in a `Sheet` and report the result with a `Toaster` toast.

Build these screens, in this order:

1. **Overview** — a grid of `Card`s from the ops-dashboard backend: total balances, pending-withdrawal count, today's deposits/withdrawals, and circuit-breaker status (green/amber/red `Badge`s). Numbers count up once on load. Read-only.
2. **Withdrawals (review queue)** — a `ListRow` per pending withdrawal (player, amount, address, state). Tapping opens a `Sheet` with **Approve / Reject**, calling the internal withdrawal endpoints. Any withdrawal **over ₮10,000 must require a second person's confirmation** in the UI (a two-step confirm) — the backend enforces it too; the UI must not let a single click release a large withdrawal.
3. **Players** — a search `Input`, then a `ListRow` list; tapping shows a read-only player card (balance, reputation, status). **No balance editing from the UI** — ever.
4. **Leagues** — league list with **top-up / cash-out** actions in a `Sheet` (money actions → same confirm pattern, senior-reviewed).
5. **Alerts** — the circuit-breaker states (CB1–CB7) and recent security-log events, newest first, each a `ListRow` with a severity `Badge`.

**Rules for admin money actions:** they call the existing internal endpoints — the UI **never** writes a balance itself; large operations require the two-person confirm; and anything touching money is senior-reviewed before merge.

---

## 4. Ops delivery
Mirror the security audit log to remote syslog, and deliver circuit-breaker alerts to Telegram (the hook exists; it only logs to the console today). Coordinate with the senior on these.

## 5. Tests
A settlement test for Dou Di Zhu, regression fixtures, and the launch QA checklists.

---

## Rules
- Anything that touches money (the deposit/withdrawal email hooks, the admin money actions) is reviewed by the senior before it merges — money code is never merged without that review.
- Branch per task off `main`, open a PR, keep it to one thing.
