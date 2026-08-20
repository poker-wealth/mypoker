# mobile — the native app (Expo Bare)

React Native + Expo. The iOS/Android app; the Mini App lives in `frontend/`. See the root `CLAUDE.md` for the iron rules.

## Bare Workflow is non-negotiable

The 12-week plan, Week 1: *"Confirm Expo Bare Workflow (non-negotiable — Managed Workflow is blocked)"*, with an escalation clause if it fails. The reason is the acceptance criterion: *"Root/jailbreak detection SDK runs on physical iOS and Android device."* Managed cannot load that SDK.

Practically: custom native modules are allowed and expected, `expo prebuild` owns the native projects, and **Expo Go will not run this app** — it needs a development build.

## No Mac in this project

iOS is built through **EAS cloud builds**; Android builds locally on Windows. Consequences that shape how we work:

- **Android is the fast loop.** Seconds per build, real device or emulator.
- **iOS is a ~10–20 minute cloud round-trip.** Batch iOS checks; do not iterate on them.
- **No native debugger on iOS.** A native-module bug there is diagnosed blind, through slow builds. So prefer native dependencies with proven RN + iOS support over elegant ones, and smoke-test anything native on a real iPhone *early* — the same reasoning as the Bare gate itself.

Owner dependencies: an Expo account, an Apple Developer account ($99/yr) for iOS submission, and a Google Play Console account.

## Ownership split (SAMUEL_V2 task 8 / ESTHER_V2 task 6)

| | owner |
|---|---|
| App shell, navigation, auth, wallet, non-game screens | Samuel |
| Root/jailbreak detection + device anti-bot probes | Samuel |
| Store submission, listing assets, <100MB budget | Samuel |
| Felts and the live-table transport, all 9 games | Esther |

**The seam:** the shell provides the session token and a `tableId`. Everything from the socket up is the game side. One API client, one session store — if there are two, they have already drifted.

## The transport does not port as-is

`frontend/src/api/tableSocket.ts` is built on **Web Crypto**: `crypto.subtle` for X25519 keygen, ECDH and HKDF, HMAC on every envelope, plus `TextEncoder`. React Native has none of that.

Porting means swapping the crypto provider, not copying the file. Put the primitives behind a small interface so the socket becomes provider-agnostic — Web Crypto for the Mini App, native here:

```ts
interface WireCrypto {
  generateKeyPair(): Promise<{ publicKeySpkiB64: string; privateKey: unknown }>;
  deriveSessionKey(privateKey: unknown, serverPublicKeySpkiB64: string): Promise<unknown>;
  sign(sessionKey: unknown, seq: number, payload: string): Promise<string>; // base64 HMAC
}
```

**Exact parameters the server expects** (`frontend/src/api/tableSocket.ts:211-256`) — any drift and the MAC silently fails:

- X25519 ECDH -> 256-bit shared secret
- HKDF-SHA256, **empty salt**, info `fairplay-ws-v1`, 32 bytes out
- HMAC-SHA256 over the string `${seq}.${payload}`, base64 encoded

**The trap: public keys cross the wire as SPKI, not raw.** Web Crypto imports and exports SPKI natively; native X25519 libraries almost always hand you **raw 32 bytes**. For X25519, SPKI is a fixed 12-byte DER prefix followed by the raw key — the native provider must prepend it on export and strip it on import. Skip that and the handshake looks fine while deriving a different secret; it surfaces as a rejected MAC, far from its cause.

Verify X25519 + HKDF on a real iPhone before building on top.

## Rules carried over from the Mini App

These are product rules, not web rules — they apply here too:

- **Never render an invented figure.** No sample data, no placeholder counts. An em dash beats a made-up number.
- **Every user-facing string is translated in all 8 languages.** A missing key renders raw.
- **Money through the API only.** The app never computes a balance.
- Brand: near-black `#0d0d1a`, violet `#bb5cf6`, cyan `#00d4ff`. Gold is for jackpots and nothing else.

## Commands

```bash
npm start                  # Metro
npm run android            # local Android build + run
npx expo prebuild          # (re)generate the native projects
npx eas build -p android --profile development
npx eas build -p ios --profile development     # cloud; no Mac needed
```

`EXPO_PUBLIC_API_URL` points at the gateway. On an Android emulator the host machine is `10.0.2.2`, not `localhost`.
