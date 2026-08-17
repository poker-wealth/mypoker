# Samuel — task list V2

**"Done" this round means it works end-to-end in the real app**, not that the code exists. Your V1 shipped notifications, admin, and frontend polish; V2 is proving them against real data, closing the gaps, and co-owning the native app.

## Read first
- `financial-core/src/notifications/email/` — your V1 email code (now merged, needs verifying).
- `frontend/src/pages/admin/*` and the feature screens under `frontend/src/pages/`.
- `frontend/src/components/poker/ChatBox.tsx` / `useTableChat.ts` — where voice notes attach.

## Tasks, in order

1. **Email notifications — verify it actually works (do first; it merged unverified).** The nodemailer install was network-blocked when #13 merged, so FC was never typechecked with it. Run `cd financial-core && npm install && npm run typecheck && npm test`. Then confirm end-to-end: a deposit credit sends the "received" email, a withdrawal sends on requested + on sent/confirmed, and the event-id dedupe stops a retry double-sending. **Senior-reviewed (money-touching). SMTP creds come from the owner.**

2. **Voice notes at the table.** Not a call, not Agora — an **async voice message**: press-and-hold to record a short clip, send it into the table chat namespace, others tap to play. Cap the length + size, isolate the namespace, and a voice error must never affect the game (same isolation rule as text chat). Wire it into the existing chat transport.

3. **Create Private Table.** The UI exists but is disabled — there's no create-table endpoint (`Lobby.tsx:301-308`). Build the gateway endpoint (pair with Victor on the room-creation/money shape), then wire the button and verify a player can create and join a private table.

4. **End-to-end verify every feature screen against real data.** Profile (real stats), VIP, Jackpot, Insurance, Alliance, Agent Center, Notifications, Data tab, Settings. Each must show live server data and its controls must work — not just render. Fix the gaps you find.

5. **Admin area — end-to-end verify.** Overview / Withdrawals / Players / Leagues / Alerts against live data. Confirm the **>₮10,000 two-person confirm** genuinely blocks a single-click release in the UI (the backend enforces it too).

6. **Public RTP feed — on-chain rule-version stamp.** The feed shows lifetime rates but the per-round on-chain rule/paytable commitment stamp is still deferred (`Fairness.tsx:281-287`). Finish it.

7. **Launch-QA checklists** (`docs/LAUNCH-QA.md`) — complete them.

8. **Native mobile app — with Esther (starts this week, spans beyond).** You own the **app shell**: React Native + Expo **Bare Workflow** init (spec: non-negotiable, Managed is blocked), port the non-game screens + wallet + auth, **native root/jailbreak detection + device anti-bot probes** (only run on a real device), voice notes on native, then **app-store submission** — iOS App Store + Google Play, <100MB, multi-language store assets, submit for review. Esther owns the game/table side.

## Rules
- Anything touching money (email hooks, the create-table money shape, admin money actions) is **senior-reviewed** before it merges.
- Match the existing design system + i18n — don't invent a new look or hardcode strings.
- Branch per task off `main`, one thing per PR.
