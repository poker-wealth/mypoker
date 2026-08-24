# Testing on a physical Android phone

The gateway is not deployed anywhere public — every config in the repo points at
`localhost:4100`. So a phone reaches it through a tunnel, and the app is told
that tunnel's URL **at runtime** rather than at build time.

That runtime part matters: free tunnels issue a new URL every session, and
`EXPO_PUBLIC_API_URL` is baked in when the APK is built. Without the override
you would rebuild — fifteen minutes in the cloud — every time you restarted the
tunnel.

## Once, ever

Build the APK and install it:

```bash
cd mobile
npx eas build -p android --profile device
```

EAS builds it in the cloud (~10–20 min) and gives you a download link. Open that
link on the phone, or email the APK to yourself. Android will ask you to allow
installs from unknown sources — that is expected for a build that never went
through the Play Store.

**The `device` profile exists for exactly this** and differs from the others in
two ways: it bakes in no API URL, and it sets `EXPO_PUBLIC_ALLOW_API_OVERRIDE`,
which is what makes the Developer field appear. No other profile has it, so a
production build cannot show or use the override.

## Every session

**1. Start the stack** (three terminals, from the repo root):

```bash
# 1 — an in-memory Mongo, writes its URI to the file you name.
# A Windows-native path, NOT /tmp: Git Bash and node disagree about where
# that is, and node writes to C:/tmp, which may not exist.
npx ts-node financial-core/scripts/smoke-mongo.ts C:/Users/samuel/mongo-uri.txt

# 2 — financial-core
cd financial-core
PORT=4001 MONGO_URI="<uri from above>" MONGO_TLS=false \
  JWT_SECRET=devsecret INTERNAL_API_SECRET=devsecret npx ts-node src/index.ts

# 3 — the gateway
cd game-server
PORT=4100 FINANCIAL_CORE_URL=http://127.0.0.1:4001 \
  JWT_SECRET=devsecret INTERNAL_API_SECRET=devsecret npx ts-node src/gateway/server.ts
```

`JWT_SECRET` must match between financial-core and the gateway or every call
401s.

**2. Open the tunnel** (fourth terminal):

```bash
~/tools/cloudflared.exe tunnel --url http://localhost:4100
```

It prints an `https://<random>.trycloudflare.com` URL. That URL is HTTPS, which
also sidesteps Android 9+'s block on cleartext HTTP — a plain LAN IP would fail
with a confusing network error instead.

**3. Point the app at it.** On the phone, on the login screen, under
**Developer — API URL**, paste the tunnel URL and press Save. Restart the app.

The field is on the login screen deliberately: Settings is only reachable after
signing in, and signing in needs a working API URL. Without it there, a stale
tunnel URL would brick the build until you rebuilt it. It is also in Settings,
below sign-out, for when you are already signed in.

**4. Create an account.** Sign-up works from the login screen — no invite
needed. Nothing carries over from the Mini App; this is a separate account
unless you sign in with the same credentials.

## What is worth checking on the device

These are the things that could only be verified by arithmetic or stubs on a
development machine:

- **Root/jailbreak detection.** A normal phone should report clean — no warning
  banner on the wallet screen. An emulator usually trips root detection, so it
  *should* warn there. Both directions matter: a detector that never fires is
  as broken as one that always does.
- **Voice note size.** The recorder is pinned at 16kbps mono AAC to fit a 24KB
  ceiling for ten seconds, with about 1,504 bytes of margin. Hold the record
  button for the full ten seconds. If it refuses to send with "that recording
  was too large", the encoder overshot the bitrate hint and
  `BITS_PER_SECOND` in `src/useVoiceRecorder.ts` needs dropping to 12–14k.
- **Slide-off cancels.** Press and hold the record button, slide your finger off
  it, release. It must NOT send. This was wired wrong once already — RN fires
  `onPressOut` on slide-off as well as release.
- **Session expiry.** Sign in, then stop the gateway. Any screen should get a
  401 and the app should return you to the login screen rather than sitting
  there erroring.

## When something does not load

Open **Developer — API URL** (login screen, or Settings below sign-out). The
field is seeded with the override actually in force, so whatever it shows is
what the app is calling. Empty means no override saved, and since the `device`
profile bakes in no URL either, every request will fail with "No API URL
configured".

Note the debug banner at the bottom of the app is **not** shown in a `device`
build — it is gated on `__DEV__`, and this profile is a release build. The
field above is the way to check.
