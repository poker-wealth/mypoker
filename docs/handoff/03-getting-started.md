# 03 · Getting Started

Goal: from a fresh clone to backend + frontend running locally, tests green. ~30 minutes.

## Prerequisites

- **Node.js ≥ 20 LTS** and npm.
- **Docker Desktop** — the easiest way to get MongoDB (as a replica set) + Redis. *(Alternative:
  run `financial-core` with its in-memory Mongo — see the no-Docker note below.)*
- Git.

## 1. Clone & install

```bash
git clone https://github.com/poker-wealth/mypoker.git
cd mypoker
npm run install:all        # installs financial-core, game-server, and frontend
```

## 2. Start local infrastructure (MongoDB replica set + Redis)

`financial-core` uses **MongoDB transactions**, which require a **replica set** — a plain
single mongod will not work. The repo's `docker-compose.yml` provides both services:

```bash
docker compose up -d       # starts mongo:7 (replica set "rs0") on :27017 and redis:7 on :6379
```

First time only, initiate the replica set (one command, once):

```bash
docker compose exec mongo mongosh --quiet --eval "rs.initiate()"
```

**No-Docker alternative:** you can skip Docker entirely for backend dev by running
`financial-core` against an in-memory Mongo replica set:

```bash
npm --prefix financial-core run dev:memory
```

(You'll still want Redis for the full money paths; the in-memory mode is fine for most work.)

## 3. Configure environment

```bash
cp financial-core/.env.example financial-core/.env
```

The dev defaults in `.env.example` already point at the docker-compose Mongo/Redis, so for local
work you usually don't need to change anything. Key vars (see the file for all):

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `4001` | financial-core HTTP port |
| `MONGO_URI` | `mongodb://localhost:27017/fairplay_fc?replicaSet=rs0` | must be a replica set |
| `REDIS_URL` | `redis://localhost:6379` | idempotency keys + locks |
| `INTERNAL_API_SECRET` | `change-me…` | game-server → financial-core auth |
| `JWT_SECRET` | `change-me…` | player token signing/verify |

> **Never commit `.env`.** It's gitignored. Secrets for staging/prod live in Heroku/Netlify
> config, not in the repo.

`game-server` currently has no `.env.example`; it runs on sensible defaults. Confirm any config
it needs as you wire real auth (S1/S2 in the week plan).

## 4. Run the backend

Two terminals:

```bash
# terminal 1 — financial-core (the money), :4001
npm --prefix financial-core run dev        # or: run dev:memory  (no Docker Mongo needed)

# terminal 2 — game-server HTTP + WebSocket gateway
npm run app                                # scripts/app-server.ts (logs its URL on boot)
```

Want to *see the games* without any setup? These run standalone (in-memory demo wallet):

```bash
npm run web            # game-server web demo in the browser
npm run demo           # all-games console demo
npm run demo:texas     # a Texas hand in the console
```

## 5. Run the frontend

```bash
npm run dev            # Vite → http://localhost:5173
```

Open `http://localhost:5173`, click through the four tabs, and play a hand at a table. (This is
still the **demo engine** — it doesn't need the backend yet; see doc 05.)

## 6. Run the tests

```bash
npm test               # runs financial-core + game-server suites (Jest, ~482 tests)
# or individually:
npm run test:fc
npm run test:gs
npm run smoke          # financial-core smoke test
```

`npm run verify` runs typecheck + lint + tests across both backend packages — run it before any
backend PR (see [07-git-workflow.md](07-git-workflow.md)).

## Ports at a glance

| Service | Port |
|---------|------|
| financial-core | 4001 |
| game-server (app gateway) | logged on boot — confirm and note it |
| frontend (Vite dev) | 5173 |
| MongoDB | 27017 |
| Redis | 6379 |

## Common issues

- **Transactions fail / "not a replica set":** you skipped `rs.initiate()` (step 2) or Mongo
  isn't a replica set. Use `dev:memory`, or initiate the RS.
- **Redis connection refused:** `docker compose up -d` didn't start Redis, or it's on another
  port. Check `REDIS_URL`.
- **`ts-node` errors on Windows:** make sure you're on Node ≥ 20 and ran `npm run install:all`.
- **Frontend can't reach backend (later, once wired):** check `VITE_API_URL` and CORS on the
  game-server gateway.
