# Poker Game Guide V1 — This Week's Tasks

The task plan for the whole team this week, compiled in one place. Built from a full audit of the codebase against the FairPlay spec (v5.9 base + v6.0 UltraFair).

**The bar for "done":** the whole vertical works end-to-end for a real player — sit, play a full round, win/lose, and the wallet updates on screen, in the actual app. A file that exists and a green unit test is *built*, not *done*.

## Who owns what

| Person | Lane | Doc |
|---|---|---|
| **Esther** | Games → proven end-to-end (fix the DDZ seed, clean up duplicates, play-verify each game, un-hide Baccarat/Cowboy&Beauty), + native app **game/table side** | [Esther.md](Esther.md) |
| **Samuel** | Notifications (verify email), voice notes, Create Private Table, feature-screen + admin E2E, + native app **shell/wallet/store side** | [Samuel.md](Samuel.md) |
| **Victor** (senior) | Money core, fairness (future-block), anti-bot signals, third-party game connectors, infra/mainnet, launch QA, review every money PR | [Victor.md](Victor.md) |
| **Olivia** (tester, non-dev) | Play-tests every game + money flow + screen end-to-end and reports what breaks — she is the ground truth for whether something is "done" | [Olivia.md](Olivia.md) |

## Shared this week
- **Native mobile app (iOS + Android, React Native / Expo Bare Workflow)** — Esther owns the game/table side, Samuel owns the shell/wallet/auth + store submission. Starts this week, spans beyond.
- **Testing loop:** Esther's and Samuel's "verify end-to-end" tasks are proven by **Olivia** playing them. She files what breaks; they fix; she re-tests. A game/screen is only marked done once Olivia has played it through and the money was right. Victor gives her app access + test funds and the channel to file in.

## Spec corrections baked into these tasks
- **Slots + Lottery are third-party (PG Soft) integrations**, not in-house — provider-blocked.
- **Native iOS + Android is in full scope** (three platforms: iOS / Android / TG Mini App).
- **Voice = async voice notes**, not a live call / not Agora.

## Blocked on the owner (Victor to chase early — these gate the above)
- Mainnet keys + funding (TRON xpub, hot-wallet **or** AWS KMS CMK, Solana keypair)
- **PG Soft:** static egress IP (Fixie) + integration form + sandbox creds → unblocks Slots + Lottery
- SMTP mailbox creds (email) · SMS provider (if OTP) · 3-node infra machines

## Honest note
The games / fairness / frontend / notifications **verification is a real this-week push.** The native app (with app-store review), mainnet cutover, 3-node stand-up, and chaos drills **start this week but won't fully land in seven days** — several are gated on owner provisioning. These docs sequence the work; they don't pretend it all fits in one week.
