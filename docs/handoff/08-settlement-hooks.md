# Settlement hooks — two calls P1 needs to make

**For:** whoever owns settlement (P1).
**Why:** VIP, per-game RTP, play distribution and in-app notifications are all
built, tested and deployed. They are empty until settlement tells them a hand
happened.

Both hooks are **additive** and **outside the money path**. Neither changes a
schema, a ledger write, or anything a balance depends on. If a hook fails, the
hand is still settled correctly — these are counters and messages beside the
money, not part of it.

Both are internal endpoints on financial-core, behind `INTERNAL_API_SECRET`
(the same header the deposit and settlement endpoints already use). A player
cannot call either; both 401 without the secret.

---

## Hook 1 — play volume

```
POST /api/v1/internal/volume
x-internal-secret: <INTERNAL_API_SECRET>
content-type: application/json

{
  "playerId": "tg-123456",
  "gameId":   "texas",
  "staked":   10000000,
  "won":      19000000
}
```

- `staked` / `won` are **micro-USD integers**, like everything else in
  financial-core. `$10.00` is `10000000`.
- `won` is what came back to the player — `0` when they lost.
- **Call once per player per settled hand**, so a 6-handed hand makes 6 calls.
- Returns `204`. Nothing to read.

**Why settlement and not the ledger.** The ledger records that money moved, not
which game it moved in. Effective volume needs the game, because the VIP ladder
weights it: Texas ×1.0, Niu Niu ×0.5, Baccarat ×0.3, everything else ×0.4. The
spec is explicit that this exists to stop low-rake games being a shortcut up the
tiers. Settlement is the only place that knows the game at the moment the money
moves.

**What it turns on**

| Feature | Endpoint |
|---|---|
| VIP tier and progress | `GET /me/vip` |
| Per-game actual RTP | same response, `breakdown[].actualRtp` |
| Play distribution | same response, `breakdown[]` |

**Failure handling:** log and continue. A dropped call loses a hand's worth of
VIP progress; a settlement rolled back because a counter was unreachable loses
the hand. Never let this throw into the settlement path.

---

## Hook 2 — notifications

```
POST /api/v1/internal/notifications
x-internal-secret: <INTERNAL_API_SECRET>
content-type: application/json

{
  "playerId": "tg-123456",
  "kind":     "RESULT",
  "titleKey": "notifications.handWon",
  "eventId":  "round-8f3a:tg-123456",
  "params":   { "amount": "12.50" }
}
```

- `kind` — one of `RESULT`, `DEPOSIT`, `PROMO`, `JACKPOT`, `SYSTEM`.
- `titleKey` — a **translation key**, never prose. The player's language is
  resolved when they read it, so a hand settled at 3am is described in whatever
  language they are reading in now. Keys live in
  `frontend/src/i18n/locales/*.json` under `notifications.*`.
- `eventId` — **anything stable and unique per event.** `${roundId}:${playerId}`
  works. This is the idempotency key.
- Returns `{ "stored": true }`, or `{ "stored": false, "suppressed": true }`
  when the player has that category switched off. **Suppressed is not an
  error** — do not retry it.

### Keys that already exist

| Situation | `kind` | `titleKey` | `params` |
|---|---|---|---|
| Player won a hand | `RESULT` | `notifications.handWon` | `{ amount }` |
| Hand settled, player down | `RESULT` | `notifications.handLost` | `{ amount }` |
| Deposit credited | `DEPOSIT` | `notifications.deposit` | `{ amount }` |
| Withdrawal broadcast | `DEPOSIT` | `notifications.withdrawal` | `{ amount }` |
| Jackpot hit | `JACKPOT` | `notifications.jackpot` | `{ amount }` |
| VIP tier reached | `RESULT` | `notifications.vipUp` | `{ tier }` |
| Withdrawal address changed | `SYSTEM` | `notifications.addressChanged` | — |

Need a key that isn't there? Add it to all eight locale files — `npm run build`
in `frontend/` fails if they drift apart.

**Preferences are applied at write time**, not on read. A player who turned
promos off does not have marketing stored for them. `SYSTEM` is never
suppressible: "your withdrawal address changed" is not marketing.

**Failure handling:** same as hook 1. Log and continue. A missing notification
is a missing notification; a rolled-back settlement is a lost hand.

---

## Verifying locally

```bash
# financial-core, in-memory Mongo, no install needed
cd financial-core && npm run dev:memory        # :4001

# in another shell
FC=http://127.0.0.1:4001/api/v1
SEC=dev-internal-secret

curl -X POST $FC/internal/volume \
  -H "x-internal-secret: $SEC" -H 'content-type: application/json' \
  -d '{"playerId":"tg-1","gameId":"baccarat","staked":60000000000,"won":36000000000}'

# $60,000 staked at x0.3 -> $18,000 effective
curl $FC/me/vip -H "Authorization: Bearer <player token>"
```

`npm run dev:memory` prints a ready-made player token on startup.

---

## What is still not covered

**Insurance (feature queue #16)** needs a third hook that does not exist yet,
because it is not a settlement event — it fires mid-hand, at the all-in.

The spec pins the behaviour completely: **Texas Hold'em only**, **2-player
all-in activates, 3+ silently skips**, quote inside 30ms from a cache warmed at
flop/turn, and **RiskFactor is never exposed to the UI**. What it needs from the
engine is an event at the moment two players are all-in, carrying the final odds
and nothing else.

That is a live-table concern rather than a settlement one, so it wants designing
together rather than specifying here.
