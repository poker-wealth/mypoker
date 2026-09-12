import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api } from './api';
import { theme } from './theme';

/**
 * Push notifications for the native app.
 *
 * The Mini App has never needed this: inside Telegram the bot reaches the
 * player wherever they are. A native install has nothing equivalent — before
 * this, a deposit was stored, badged, and completely invisible until the player
 * next opened the app, which for money is the wrong way round.
 *
 * ── This does nothing until credentials exist ──────────────────────────────
 *
 * A token is only issued for a build whose EAS project carries the platform
 * credentials: a Firebase project (FCM) for Android, an Apple Developer account
 * for iOS. Without them `getExpoPushTokenAsync` throws, which is why every step
 * here is guarded and returns rather than propagating — a player must never see
 * sign-in fail because notifications could not be arranged.
 *
 * The two platforms are independent, so Android can ship on its own.
 */

/**
 * How a notification behaves when it lands while the app is open.
 *
 * Shown, not swallowed. The default is to suppress the banner on the grounds
 * that the user can already see the app — but they may be sitting at a table
 * rather than on Messages, and "your withdrawal completed" is worth surfacing
 * wherever they are. The badge alone would not be noticed mid-hand.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/** Remembered so sign-out can hand the server the exact token to drop. */
let currentToken: string | null = null;

/**
 * Android needs a channel before anything can arrive with sound or priority.
 *
 * Created on every start rather than once: channels are owned by the OS, not
 * the app, so this survives reinstalls and is a no-op when it already exists.
 * Skipping it does not error — the notification simply arrives silently, which
 * is the sort of failure nobody reports and everybody suffers.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Account & money',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: theme.brand,
    // Matches the `sound: 'default'` the server sends.
    sound: 'default',
  });
}

/**
 * Ask for permission, get a token, and tell the server about this device.
 *
 * Call after sign-in, not before: the token is registered against a session, so
 * asking a signed-out visitor to allow notifications would prompt them for
 * something we could not yet act on. Safe to call repeatedly — the app
 * re-registers on every launch because the OS can rotate a token at any time,
 * and the server's upsert makes that cheap.
 */
export async function registerForPush(): Promise<void> {
  // A simulator has no push service and always fails; not an error worth a log
  // line on every developer's machine.
  if (!Device.isDevice) return;

  try {
    await ensureAndroidChannel();

    // Ask only if we have not been answered before. Re-prompting someone who
    // said no is not possible on iOS anyway — the second call returns the
    // stored denial — but checking first keeps the intent clear.
    const existing = await Notifications.getPermissionsAsync();
    const decision =
      existing.status === 'granted' ? existing : await Notifications.requestPermissionsAsync();
    // A refusal is a legitimate answer, not a failure. The in-app badge still
    // works; they simply will not be interrupted.
    if (decision.status !== 'granted') return;

    // The projectId is required in a bare/dev-client build — without it Expo
    // cannot tell which credentials to mint against, and throws.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId ??
      undefined;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    currentToken = token;

    await api.post('/me/push-tokens', {
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
  } catch (err) {
    // Deliberately swallowed. No credentials yet, permission revoked in
    // Settings mid-session, Expo unreachable — none of these are reasons to
    // break the screen the player is looking at.
    console.warn('[push] not registered:', err);
  }
}

/**
 * Drop this device on sign-out.
 *
 * Matters more than it looks on a shared handset: without it the next person to
 * sign in keeps receiving the previous player's deposit and withdrawal notices
 * on the lock screen. The server also moves a token when it is re-registered by
 * someone else, so this is the belt to that braces — but sign-out is the moment
 * we actually know the device changed hands.
 */
export async function unregisterFromPush(): Promise<void> {
  const token = currentToken;
  if (!token) return;
  currentToken = null;
  try {
    await api.del('/me/push-tokens', { token });
  } catch (err) {
    console.warn('[push] could not unregister:', err);
  }
}
