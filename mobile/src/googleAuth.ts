/**
 * Native Google sign-in, isolated from auth.tsx so the rest of the app never
 * has to import the native library directly. Everything here is inert until
 * EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is supplied — the OAuth client IDs do not
 * exist yet.
 */

export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
export const GOOGLE_ENABLED = GOOGLE_WEB_CLIENT_ID !== '';

type GoogleModule = typeof import('@react-native-google-signin/google-signin');

/**
 * The native library, required at CALL time rather than imported at the top.
 *
 * A static import runs `TurboModuleRegistry.getEnforcing('RNGoogleSignin')` the
 * moment this file is loaded — and it is loaded at boot, because LoginScreen
 * reads `GOOGLE_ENABLED` from here. So any binary without the module compiled in
 * (a dev client built before the dependency was added, or a build that leaves it
 * out) died on a red screen before the first screen rendered, for a feature that
 * is switched OFF. Requiring it here keeps the promise the comment above makes:
 * nothing native is touched until someone actually signs in with Google.
 */
function nativeGoogle(): GoogleModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-google-signin/google-signin') as GoogleModule;
  } catch {
    // Configured but not in the binary — a build mismatch, not a user error.
    // Say which, because "could not be found" alone sends people hunting for a
    // missing client id instead of rebuilding the app.
    throw new Error(
      'Google sign-in is not in this build — rebuild the app after adding @react-native-google-signin/google-signin',
    );
  }
}

/**
 * Runs the native Google sign-in flow and returns an ID token, or `null` if
 * the user cancelled. Throws on any other failure.
 */
export async function signInWithGoogleNative(): Promise<string | null> {
  if (!GOOGLE_ENABLED) {
    throw new Error('Google sign-in is not configured');
  }

  const { GoogleSignin, statusCodes } = nativeGoogle();

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
