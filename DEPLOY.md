# Deploy — Heroku (backend) + Netlify (frontend)

Goal: live URLs so we can respond to a games provider (Frontend URL, API URL, an IP to whitelist). This first pass deploys **Financial Core** + **gateway** + **frontend**. The live game socket (table server) and mainnet chain come later — the provider handshake doesn't need them.

## Topology
| Service | Where | Start | Serves |
|---|---|---|---|
| financial-core | Heroku app `mypoker-fc` | `npm start` → `node dist/index.js` | the money API (internal) |
| game-server gateway | Heroku app `mypoker-gateway` | `npm start` → `node dist/gateway/server.js` | the public API + auth (this is the **API URL** for the provider) |
| frontend | Netlify (already configured) | `vite build` | the Mini App (the **Frontend URL**) |
| table server | *later* — its own app, or folded into the gateway | | live gameplay socket |

The two backend services live in subfolders of one repo, so each deploys with `git subtree push` (no extra buildpack). Both already build to `dist` (verified) and bind `process.env.PORT`.

## Prerequisites (yours to provide)
- A Heroku account + the Heroku CLI (`heroku login`).
- **MongoDB Atlas IP allowlist → `0.0.0.0/0`.** Heroku dynos have dynamic outbound IPs; without this, both services fail to reach Atlas (this is the "IP not whitelisted" failure). Atlas URI + `MONGO_TLS=true` we already have.
- A Redis instance for Financial Core (idempotency/locks): `heroku addons:create heroku-redis:mini -a mypoker-fc`.
- Secrets: `JWT_SECRET` and `INTERNAL_API_SECRET` must be **identical** on FC and the gateway. Google OAuth id/secret, Telegram bot token, TRON keys as today.

## Deploy — Financial Core
```bash
heroku create mypoker-fc
heroku git:remote -a mypoker-fc -r heroku-fc
heroku addons:create heroku-redis:mini -a mypoker-fc
heroku config:set -a mypoker-fc \
  NODE_ENV=production MONGO_TLS=true \
  MONGO_URI='<atlas uri>' \
  INTERNAL_API_SECRET='<shared secret>' \
  JWT_SECRET='<shared secret>' \
  TRON_API_URL='https://nile.trongrid.io' TRON_API_KEY='<key>' \
  USDT_TRC20_CONTRACT='<testnet contract>' DEPOSIT_CONFIRMATIONS=1
git subtree push --prefix financial-core heroku-fc main
```
FC internal URL → `https://mypoker-fc.herokuapp.com`.

## Deploy — gateway (the provider's API URL)
```bash
heroku create mypoker-gateway
heroku git:remote -a mypoker-gateway -r heroku-gw
heroku config:set -a mypoker-gateway \
  NODE_ENV=production MONGO_TLS=true \
  MONGO_URI='<atlas uri>' \
  JWT_SECRET='<same as FC>' INTERNAL_API_SECRET='<same as FC>' \
  FINANCIAL_CORE_URL='https://mypoker-fc.herokuapp.com' \
  GOOGLE_CLIENT_ID='<id>' GOOGLE_CLIENT_SECRET='<secret>' \
  TELEGRAM_BOT_TOKEN='<token>' \
  CORS_ORIGINS='https://mypoker777.com,https://www.mypoker777.com'
git subtree push --prefix game-server heroku-gw main
```
Public API URL → `https://mypoker-gateway.herokuapp.com`.

**Both hosts, and both with the scheme.** `CORS_ORIGINS` is an exact-match
allowlist with no wildcard (`game-server/src/gateway/app.ts`), compared against
the browser's `Origin` header. `mypoker777.com` without `https://` matches
nothing, and if Netlify serves `www` as well then the apex alone leaves half the
visitors unable to reach the API — with no error beyond a CORS failure in the
console.

## Frontend — Netlify
The site is served at **https://mypoker777.com** (Hostinger domain).

Attach it in Netlify → Domain management → Add custom domain, then point the DNS
at Netlify (either the four `dns1..4.p0X.nsone.net` nameservers in Hostinger, or
an `ALIAS`/`CNAME` if the DNS stays with Hostinger). Netlify issues the Let's
Encrypt certificate once DNS resolves.

**HTTPS is not optional here.** Telegram refuses to load a Mini App over plain
`http://`, so `http://mypoker777.com` will fail inside Telegram whatever the site
does. Leave Netlify's "Force HTTPS" on.

Set env, then redeploy (the build guard rejects localhost, so these must be the real URLs):
- `VITE_API_URL = https://mypoker-gateway.herokuapp.com`
- `VITE_GOOGLE_CLIENT_ID = <public client id>`
- (`VITE_TABLES_URL` added when the table server deploys)

Also update, or they will still point at the old host:
- **BotFather** → the Mini App URL for the bot → `https://mypoker777.com`
- **Google OAuth** → Authorised JavaScript origins and redirect URIs → the new
  domain, or sign-in fails with `redirect_uri_mismatch`

## After deploy — smoke check
- `GET https://mypoker-fc.herokuapp.com/api/v1/health` → 200
- `GET https://mypoker-gateway.herokuapp.com/...health` → 200
- Open https://mypoker777.com, sign in with Google → confirms the frontend →
  gateway → FC chain in production.
- Open a player-scoped tab (Me / Stats). Retry cards there mean `VITE_API_URL`
  or `CORS_ORIGINS` is wrong — those screens are the honest signal that the
  frontend cannot reach the gateway.

## What the provider gets from this
- **Frontend URL** = `https://mypoker777.com`.
- **API URL** = `https://mypoker-gateway.herokuapp.com`.
- **Backoffice URL** = the admin panel (in build by Samuel) — until then, the gateway URL stands in.
- **IP to whitelist** = the outbound IP of the dyno calling them. Heroku dynos have dynamic IPs, so for a stable IP to give the provider you'll need an outbound-IP addon (e.g. QuotaGuard/Fixie) or a small proxy — flagged as a decision, because most providers require a *fixed* egress IP.

## Not in this pass (follow-ons)
- Table server (live gameplay) — its own Heroku app, or fold the hub into the gateway (one origin for HTTP + WS). Recommended before players play.
- Mainnet chain + real keys, 3-node — the W11 items.
