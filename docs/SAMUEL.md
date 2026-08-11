# Samuel — task list

Your focus is the things around the games: money notifications, frontend polish, the admin screens, and tests. These are independent of the game work, so you can start straight away off `main`.

**Work in this order. Ask questions any time, and read the relevant code until you understand it before you build — that's expected, not a delay.**

## Read first
- `financial-core/src/deposit/deposit-credit.ts` — where a deposit is credited (money in).
- `financial-core/src/withdrawal/withdrawal-state-machine.ts` — the withdrawal states (money out).
- The existing notification path: `financial-core/src/notifications/` and the `/internal/notifications` route — the platform already sends in-app notifications (hand results, jackpots). You'll add **email** alongside it.

## Tasks, in order

1. **Email notifications for money in and out** — your first task.
   - **Money in:** when a player's **deposit is credited**, email them (amount, timestamp).
   - **Money out:** when a player's **withdrawal is sent/confirmed on-chain**, email them; also email on withdrawal *requested* so they have a record.
   - Hook these into the existing notification flow rather than bolting on a parallel one — the credit path and the withdrawal state machine are where the events already fire. Add an email delivery channel next to the in-app one.
   - You'll need an email provider (SMTP or a service). The account/credentials are an owner dependency — **ask for them** rather than hard-coding anything. Study how notifications are currently stored and delivered before you wire email in.
   - Money messages must be accurate and idempotent — a retry must not send a second email for the same deposit/withdrawal. Use the same event id the notification system already uses to dedupe.

2. **Frontend polish**
   - **Phone / OTP sign-in:** today the "Phone" toggle is a relabeled email form with no real OTP. Either build the real OTP flow or remove the phone option so nothing misleads a user.
   - **Lobby:** remove the hardcoded `SAMPLE_TABLES` fallback (dead table ids) and the invented "status" dollar figure; build the "Create Private Table" flow; make the filter button work.
   - **Dead controls:** the Profile "Support" row and the table sound button do nothing — wire or remove them. Make the Games grid reflect real availability instead of a static list.

3. **Admin / ops screens** — there's a backend ops dashboard but no UI. Build: a withdrawal review queue, and the platform/league admin views (league top-up / cash-out).

4. **Ops delivery** — mirror the security audit log to remote syslog, and deliver circuit-breaker alerts to Telegram (the hook exists; it only logs to the console today). Coordinate with the senior on these.

5. **Tests** — a settlement test for Dou Di Zhu, regression fixtures, and the launch QA checklists.

## Rules
- Anything that touches money (the deposit/withdrawal email hooks) is reviewed by the senior before it merges — money code is never merged without that review.
- Branch per task off `main`, open a PR, keep it to one thing.
