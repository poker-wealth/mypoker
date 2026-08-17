# Esther — task list V2

**"Done" this round means the WHOLE game works end-to-end for a real player** — you sit, play a full round, win/lose, and the wallet updates on screen, in the actual app. A room file + a green unit test is *built*, not *done*. Your V1 shipped all the rooms; V2 is proving each one and closing the real gaps.

## Read first
- `docs/ADDING_A_GAME.md` — the recipe you already followed.
- The felt for each game: `frontend/src/components/games/*Felt.tsx` and `registry.ts`.
- `game-server/src/live/poker-room.ts` / `base-room.ts` — the room shapes.

## Tasks, in order

1. **🔴 Dou Di Zhu real-money seed fix — do this first.** DDZ is on sale but feeds its jackpot a *predictable* seed (`${roundId}:seed`) instead of the provably-fair final seed (`dou-di-zhu-room.ts:179-185`). Expose `roundInfo()` on the DDZ engine (like `TexasGame.roundInfo()`) and pass the real `finalSeed`. **This is a real-money fairness bug — senior-reviewed before merge.** If it can't land quickly, pull DDZ from sale until it does.

2. **Game cleanup (kills confusion before verification).**
   - Delete the dead `game-server/src/games/bull-bull/*` — Niu Niu is the live engine.
   - Decide `red-packet` vs `red-envelope`: one is the live room, the other a parallel stack. Keep one, delete the other, whichever the room actually uses.
   - Add the two missing room-level conservation tests: `red-packet-room.test.ts`, `texas-cowboy-room.test.ts` (copy the pattern from `baccarat-room.test.ts`).

3. **End-to-end verify each game, one at a time.** In the real app: sit → play a full round → win/lose → confirm the wallet/header updates and the felt reads correctly. Fix whatever breaks. Order: **texas → short-deck → omaha → niu-niu → san-zhang → red-packet → dou-di-zhu → texas-cowboy.** (Slots + Lottery are third-party — not yours this round; see Victor's list.) For `texas-cowboy`, first confirm with Victor it's in scope — it isn't one of the spec's 9 games.

4. **Un-hide Baccarat + Cowboy & Beauty.** Both are coded but gated off (`frontend/src/lib/games.ts` `HIDDEN_GAMES`) "until their table screens are ready." Finish their felt screens (pair with Samuel on UI), verify end-to-end, then remove them from `HIDDEN_GAMES`.

5. **Anti-bot weighting — game side.** Jackpot candidates are all scored CLEAN today (`poker-room.ts:838`, `base-room.ts:353` — "the weights module is wired, its inputs are not yet"). Feed real per-seat behaviour into the candidate weighting. **Victor owns the anti-bot signals themselves (reaction time, 3s-min, fatigue…) and reviews this — coordinate.**

6. **Native mobile app — with Samuel (starts this week, spans beyond).** You own the **game/table side** of the React Native (Expo **Bare Workflow**) app: port the felts and the live-table transport so every game plays natively on iOS + Android. Samuel owns the app shell / wallet / auth / store submission. Three-platform parity (iOS / Android / TG Mini App) is the bar.

## Rules that block a merge (unchanged)
- Money moves **only** through `deps.fc.*` — a room never writes a balance.
- **Platform is never the banker** — banker games settle player-funded.
- Amounts are **integer chips**; the rail owns the USDT boundary.
- Anything touching money (the DDZ seed, jackpot weighting) is **senior-reviewed** before merge.

Branch per task off `main`, one game/thing per PR, senior reviews before merge.
