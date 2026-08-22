import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import JailMonkey from 'jail-monkey';

/**
 * Device integrity — root/jailbreak and tamper probes (SAMUEL_V2 task 8).
 *
 * The Week-1 gate in the 12-week plan is literally "Root/jailbreak detection
 * SDK runs on physical iOS and Android device", and it is the stated reason the
 * Bare Workflow is non-negotiable: Managed cannot load this SDK.
 *
 * ── SIGNALS ARE TIERED, AND THE TIERING IS THE POINT ─────────────────────────
 *
 * Root detection produces FALSE POSITIVES. A developer with USB debugging on, a
 * user running a custom ROM, someone with mock locations enabled for a transit
 * app — none of these is a cheat, and treating them as one on a money app means
 * locking real people out of their own funds over a heuristic.
 *
 * So the probes are split:
 *
 *   CRITICAL — jailbroken/rooted, or an active hooking framework (Frida,
 *              Xposed). These mean the process itself cannot be trusted: the
 *              app's own checks can be rewritten in memory.
 *
 *   ADVISORY — ADB enabled, developer settings on, mock locations allowed,
 *              app on external storage. Each is ordinary on a developer's
 *              phone. Worth reporting; not worth accusing anyone over.
 *
 * `compromised` reflects CRITICAL only. Advisory signals ride along so the
 * server can weigh them later without this client deciding what they mean.
 *
 * ── WHAT HAPPENS ON A COMPROMISED DEVICE IS NOT DECIDED HERE ─────────────────
 *
 * The spec sets the detection requirement but is SILENT on the consequence —
 * it never says a rooted device is refused, and Anti-Bot enforcement is Week 11
 * server work that does not exist yet. Blocking withdrawals on a heuristic is a
 * product and compliance decision, not one to make in a client library.
 *
 * ASSUMPTION, pending Victor: this warns and reports, it does not block. The
 * verdict is exposed so a policy can be applied later in one place.
 *
 * ── IT MUST NEVER BREAK THE APP ──────────────────────────────────────────────
 *
 * Every probe is wrapped. A detection library that throws — on an OS version it
 * did not expect, or because a native module failed to link — must not be the
 * reason someone cannot reach their wallet. A probe that cannot answer reports
 * `null`, which is "unknown", never "fine".
 */

export interface IntegritySignals {
  /** Rooted (Android) or jailbroken (iOS). Null when the probe could not run. */
  jailBroken: boolean | null;
  /** An instrumentation framework is attached — Frida, Xposed, Substrate. */
  hookDetected: boolean | null;
  /** A debugger is attached to the process. */
  debugged: boolean | null;
  /** Android: mock locations are permitted for this app. */
  canMockLocation: boolean | null;
  /** Android: USB debugging is on. */
  adbEnabled: boolean | null;
  /** Android: developer settings are on. */
  developmentSettings: boolean | null;
  /** Android: the app is installed on external storage. */
  onExternalStorage: boolean | null;
}

export interface DeviceIntegrity {
  /** True only for CRITICAL signals. Advisory ones never set this. */
  compromised: boolean;
  /** Which critical probes fired, for the report — not for the user to read. */
  reasons: string[];
  signals: IntegritySignals;
  /** False until the probes have run; nothing should be judged before then. */
  checked: boolean;
}

export const UNKNOWN_INTEGRITY: DeviceIntegrity = {
  compromised: false,
  reasons: [],
  signals: {
    jailBroken: null,
    hookDetected: null,
    debugged: null,
    canMockLocation: null,
    adbEnabled: null,
    developmentSettings: null,
    onExternalStorage: null,
  },
  checked: false,
};

/** Runs a probe that may throw or may not exist on this platform. */
function probe(fn: () => boolean): boolean | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

async function probeAsync(fn: () => Promise<boolean>): Promise<boolean | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * Reads every probe once.
 *
 * Android-only probes are not called on iOS: jail-monkey returns a default
 * there, and a hardcoded `false` recorded as a real answer is worse than an
 * honest `null`.
 */
export async function readIntegrity(): Promise<DeviceIntegrity> {
  const android = Platform.OS === 'android';

  const signals: IntegritySignals = {
    jailBroken: probe(() => JailMonkey.isJailBroken()),
    hookDetected: probe(() => JailMonkey.hookDetected()),
    debugged: await probeAsync(() => JailMonkey.isDebuggedMode()),
    canMockLocation: android ? probe(() => JailMonkey.canMockLocation()) : null,
    adbEnabled: android ? probe(() => JailMonkey.AdbEnabled()) : null,
    developmentSettings: android
      ? await probeAsync(() => JailMonkey.isDevelopmentSettingsMode())
      : null,
    onExternalStorage: android ? probe(() => JailMonkey.isOnExternalStorage()) : null,
  };

  const reasons: string[] = [];
  if (signals.jailBroken === true) reasons.push('JAILBROKEN');
  if (signals.hookDetected === true) reasons.push('HOOKED');
  // A debugger attached to a RELEASE build is a critical signal. In a debug
  // build it is just Tuesday, and flagging it would make the warning
  // permanent for the people building the app — a warning nobody can clear is
  // a warning everyone learns to ignore.
  if (signals.debugged === true && !__DEV__) reasons.push('DEBUGGER');

  return { compromised: reasons.length > 0, reasons, signals, checked: true };
}

/**
 * The integrity verdict for this session.
 *
 * Read once at mount rather than polled: these properties do not change while
 * the app is in the foreground, and re-running root checks on every render is a
 * measurable cost for an answer that cannot have changed.
 */
export function useDeviceIntegrity(): DeviceIntegrity {
  const [state, setState] = useState<DeviceIntegrity>(UNKNOWN_INTEGRITY);

  useEffect(() => {
    let alive = true;
    void readIntegrity().then((result) => {
      if (alive) setState(result);
    });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
