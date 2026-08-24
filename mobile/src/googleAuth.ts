import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

/**
 * Native Google sign-in, isolated from auth.tsx so the rest of the app never
 * has to import the native library directly. Everything here is inert until
 * EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is supplied — the OAuth client IDs do not
 * exist yet.
 */

export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
export const GOOGLE_ENABLED = GOOGLE_WEB_CLIENT_ID !== '';

/**
 * Runs the native Google sign-in flow and returns an ID token, or `null` if
 * the user cancelled. Throws on any other failure.
 */
export async function signInWithGoogleNative(): Promise<string | null> {
  if (!GOOGLE_ENABLED) {
    throw new Error('Google sign-in is not configured');
  }

  // `webClientId` (not an Android/iOS client id) is what makes Google issue
  // an ID token whose audience is the *web* client — that is the audience
  // the gateway verifies against, so an Android- or iOS-audience token would
  // be rejected there even though sign-in itself succeeded.
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    const res = await GoogleSignin.signIn();

    if (res.type === 'cancelled') {
      return null;
    }

    // res.type === 'success' here.
    const { idToken } = res.data;
    if (idToken === null) {
      // Do NOT return null here: null is how a cancel is represented, and
      // silently returning it for this case would make a real failure look
      // like the user simply closed the sheet.
      throw new Error('Google did not return an identity token');
    }
    return idToken;
  } catch (err) {
    // Some platforms reject the promise with SIGN_IN_CANCELLED instead of
    // resolving a `{ type: 'cancelled' }` response — cover both shapes so a
    // cancel reads the same way regardless of platform.
    if (
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === statusCodes.SIGN_IN_CANCELLED
    ) {
      return null;
    }
    throw err;
  }
}
