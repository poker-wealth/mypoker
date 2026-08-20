# game-server — games, live tables, gateway

Three things in one package: the game engines, the live-table WebSocket rail, and the gateway the Mini App talks to. See the root `CLAUDE.md` for the iron rules.

## The gateway is the security boundary

- **`requireAdmin` answers 404, not 403**, to a non-ops caller. A 403 confirms the admin surface exists to a stolen player token. `league_admin` is deliberately not platform admin.
- **Identity comes from the verified token, never the request body.** `actor(req)`, `req.player.playerId`. A caller claiming to administer someone else's league is the attack these routes exist to refuse.
- **Non-membership reads as 404, not 403**, for the same reason: whether a league exists and is running tables is not a stranger's to probe.
- Validate responses from financial-core with zod rather than casting. A 200 with an unexpected shape has turned a 404 into a 403, and a `NaN` sails through every numeric bound (`NaN` compares false against both).

## Rules live here

financial-core hands over facts; this package derives reputation score/band, VIP tier, alert severity, and the platform league rake band (`LEAGUE_MIN_RAKE_BPS` / `LEAGUE_MAX_RAKE_BPS`, config — the spec deliberately declines to name the numbers).

## Money in the game path

- `settleNet` (`src/games/texas/settlement.ts`) is shared by **nine games**. Its largest-remainder allocation is where chips silently go missing; `test/games/settlement-regression` pins it. A change there moves money at every table at once.
- **`RakeConfig.cap` is an unconditional `Math.min`.** `cap: 0` rakes exactly zero — it does not mean "no cap". That shipped once and made every league table free. Use `Number.MAX_SAFE_INTEGER` for uncapped.
- **A room settles as whatever `tableType`/`leagueId` its config carries.** A league table settling as `PLATFORM` sends the league's rake to the Treasury.
- `await` your settlement. An unawaited one becomes an unhandled rejection, which in Node kills the process — one table's failure taking down every table.

## Fairness

- **`computeRoundHash` is the v6.0 verifier contract.** Adding an input silently stops every already-notarized round from verifying. `test/fairness/rule-stamp-propagation` asserts the hash stays byte-identical; if it fails, that is the conversation, not a fixture to regenerate.
- The rule-version stamp and the published manifest are built by **one** constructor (`pokerTableRules`) so a table's stamp equals the version the feed publishes. They diverged once and the published stamp became uncheckable.

## Live tables

`PokerRoom` owns seats and the clock; it never deals (that is `TexasGame`) and never writes a balance (that is the FC client). Everything is serialized through one promise queue.

Voice notes ride the table socket: capped at 10s / 24KB decoded, ~33KB on the wire against a 65,536 `maxPayload`. `ws` **fails the connection** on an oversized frame rather than rejecting the message, so the headroom test in `test/social/voice.test.ts` is load-bearing.

## Tests

`npm test` (pins `--runInBand` — see root notes). No test here touches a real database; use the fakes.
