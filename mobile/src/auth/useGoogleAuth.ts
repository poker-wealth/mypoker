import { useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

/**
 * Google sign-in, native.
 *
 * The Mini App uses `@react-oauth/google`, which is a browser library: it needs `window`, popups
 * and a page origin Google can redirect to. None of that exists here, so this is the same FLOW
 * expressed natively — the implicit flow, opened in the system browser via AuthSession, returning
 * an access token.
 *
 * That access token is exactly what the Mini App sends. The gateway's `/auth/google` takes either a
 * verified `idToken` JWT or an implicit-flow `token` it resolves through Google's userinfo endpoint
 * (see game-server/src/gateway/auth.ts), and the web client sends the latter. Sending the same
 * thing means one server path, already exercised, rather than a second one written for mobile.
 *
 * WHAT THIS NEEDS THAT CODE CANNOT PROVIDE
 *
 * An **Android OAuth client id**, created in Google Cloud against this app's package name
 * (`com.mypoker.app`) and the signing certificate's SHA-1. The web client id will NOT work: Google
 * rejects an authorisation request whose client id does not match the calling app. Until that id is
 * set as `EXPO_PUBLIC_GOOGLE_CLIENT_ID`, `ready` is false and the screen says so instead of showing
 * a button that opens a browser to an error page.
 *
 * iOS will need its own client id for the same reason.
 */

// Required so the browser tab closes and hands control back after the redirect.
WebBrowser.maybeCompleteAuthSession();

const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';

const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

export interface GoogleAuth {
  /** Opens Google and resolves with an access token, or null if it did not complete. */
  signIn: () => Promise<string | null>;
  busy: boolean;
  /** False when this build has no Google client id — the caller shows why rather than a dead button. */
  ready: boolean;
  error: string | null;
}

export function useGoogleAuth(): GoogleAuth {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (): Promise<string | null> => {
    if (!CLIENT_ID) {
      setError('Google sign-in is not configured for this build.');
      return null;
    }

    setBusy(true);
    setError(null);
    try {
      // `mypoker://` — the scheme declared in app.json. Google redirects back to it.
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'mypoker' });

      const request = new AuthSession.AuthRequest({
        clientId: CLIENT_ID,
        redirectUri,
        scopes: ['openid', 'profile', 'email'],
        // Implicit flow: Google returns the access token directly, with no client secret involved.
        // A mobile app cannot keep a secret, so the code flow's exchange step has nothing to
        // protect it — and the gateway already accepts this token.
        responseType: AuthSession.ResponseType.Token,
      });

      const result = await request.promptAsync(DISCOVERY);

      if (result.type === 'success') {
        const token = result.authentication?.accessToken ?? result.params['access_token'];
        if (!token) {
          setError('Google did not return a token.');
          return null;
        }
        return token;
      }

      // Dismissed or cancelled is not an error worth shouting about — the player changed their
      // mind. Anything else gets Google's own reason, which is more useful than ours.
      if (result.type === 'error') {
        setError(result.params['error_description'] ?? result.error?.message ?? 'Google sign-in failed.');
      }
      return null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  return { signIn, busy, ready: CLIENT_ID.length > 0, error };
}
