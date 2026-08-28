import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryCache, QueryClientProvider } from '@tanstack/react-query';
import { logError } from '@/api/errors';
import { RouterProvider } from 'react-router-dom';
import { initTelegram } from '@/lib/telegram';
import { dismissSplash } from '@/lib/splash';
import { watchConnection } from '@/store/connection';
import { Toaster } from '@/components/ui/Toaster';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { LanguageGate } from '@/components/LanguageGate';
import { Onboarding } from '@/components/Onboarding';
import { router } from '@/router';
import { isAdminHost } from '@/lib/adminHost';
import { GoogleOAuthProvider } from '@react-oauth/google';
// Imported for its side effect: initialises i18next before anything renders, so
// the first paint is already in the right language.
import '@/i18n';
import './index.css';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'unset-google-client-id';

// On the admin subdomain the panel lives at the ROOT (no /admin prefix). If an
// old /admin link is opened here, strip the prefix BEFORE the router reads the
// location — no visible redirect, just a clean URL (/admin → /, and so on).
const onAdminHost = isAdminHost();
if (onAdminHost && window.location.pathname.startsWith('/admin')) {
  const rest = window.location.pathname.slice('/admin'.length) || '/';
  window.history.replaceState(null, '', rest + window.location.search + window.location.hash);
}

initTelegram();
// The connection watcher drives the live-table socket + the "Reconnecting…"
// banner — neither of which the admin panel has. Skipping it on the admin host
// is what removes that stray banner there.
if (!onAdminHost) watchConnection();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  // The UI shows translated copy rather than raw error text, so without this the
  // actual cause would be swallowed entirely. One place, every query.
  queryCache: new QueryCache({
    onError: (error, query) => logError(String(query.queryKey[0] ?? 'query'), error),
  }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* All three sit outside the router: a connection drop, an error toast or
          the first-launch language choice has to survive navigation, and none of
          them belongs to any one screen. The connection banner, language gate and
          onboarding are player-app concerns — the admin host shows none of them. */}
      {!onAdminHost && <ConnectionBanner />}
      <Toaster />
      {!onAdminHost && <LanguageGate />}
      {!onAdminHost && <Onboarding />}
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <RouterProvider router={router} />
      </GoogleOAuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Two frames, not one: after `render` returns React has committed to the DOM but
// the browser has not yet painted it. Dismissing here would fade the splash out
// over a blank screen. The second rAF fires once the app's first frame is up.
requestAnimationFrame(() => requestAnimationFrame(dismissSplash));
