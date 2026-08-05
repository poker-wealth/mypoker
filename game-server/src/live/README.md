# Live tables

A real multiplayer poker table: several people, several devices, one authoritative hand.

This is what the demo table never was. `frontend`'s `/table/:id` used to deal cards in the browser
against bots; now the seats, the deck, the pot and the clock all live here, and the browser only
draws what the server sends it.

## Running it

```bash
# same JWT_SECRET as the gateway — that's the only thing the two share
JWT_SECRET=... npm run tables      # http://localhost:4200, socket at ws://localhost:4200/ws
```

| Endpoint | What it's for |
|---|---|
| `GET /health` | liveness |
| `GET /api/live/tables` | the table list (name, blinds, seats taken) |
| `GET /api/live/chips` | your buy-in budget (needs the player's bearer token) |
| `ws://…/ws` | the game socket — everything that happens at a table |

## What talks to what

```
 browser ──ws──► TableHub ──► PokerRoom ──► TexasGame ──► ChipBank ──► (Financial Core)
                    │            │
             verifies the     seats, clock,
             player token     buy-ins, showdown
```

- **`poker-room.ts`** — the table. Who's in chair 4, when there are enough players to deal, whose
  turn it is and how long they have, what happens when someone's phone dies. It never deals a card
  or moves a chip itself.
- **`table-hub.ts`** — the rooms plus the secure socket in front of them. The transport underneath
  (`src/transport/`) does the ECDH handshake, per-message HMAC and rate limiting unchanged.
- **`room-state.ts`** — the wire contract. `TableSnapshot` out, `TableCommand` in.
- **`chip-bank.ts`** — a play-chip `FinancialCoreClient`, so hands settle with no database.
- **`players.ts`** — the two seams below.

## The two seams

The table deliberately owns neither identity nor money.

**Identity** — `TokenVerifier` turns the token on the handshake into a player id. Today that's the
gateway's `verifyToken` (`src/gateway/tokens.ts`), so the socket trusts exactly the JWT the REST API
trusts. Sign-in, Telegram and accounts stay entirely in the gateway.

**Money** — `PlayerDirectory` + `ChipLedger` (implemented by `DevPlayers` for now) hold chips as
available/locked, the same shape the Financial Core uses. Construct the rooms with
`HttpFinancialCoreClient` instead of `ChipBank` and the same hands settle through the real ledger —
no room code changes.

## Rules the table keeps

- **Your cards are in your snapshot and nobody else's.** Snapshots are built per viewer; an
  opponent's client is never sent your hole cards before showdown.
- **Legal actions are computed for the seat to act and sent only to them.** A client that invents a
  raise gets `not your turn`.
- **Chips are conserved.** Every chip a loser gives up lands on a winner or in a house sink; the
  tests assert `ledger.totalChips() + bank.sinkTotal()` never moves.
- **A dropped connection costs you nothing.** You keep your seat, your clock checks or folds for
  you, and if you never come back the chair is freed and your chips go home.

## Tests

```bash
npx jest test/live
```

`poker-room.test.ts` drives the room the way a client does. `table-hub.test.ts` opens two real
WebSocket connections and plays a hand between them. `browser-handshake.test.ts` checks the
browser's WebCrypto handshake derives the same session key as the server's `node:crypto` one — if
those ever drift, tables break in the browser and nowhere else.

## Not done yet

- Table chat (the transport carries it; the room doesn't expose it).
- Side-pot display: the engine builds side pots correctly, the UI draws one pot.
- Seat display names arrive from the client (the gateway stores no player rows), so they're a label
  only — never identity. When the gateway persists profiles, read them here instead.
