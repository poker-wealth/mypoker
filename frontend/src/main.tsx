import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { initTelegram } from '@/lib/telegram';
import { dismissSplash } from '@/lib/splash';
import { watchConnection } from '@/store/connection';
import { Toaster } from '@/components/ui/Toaster';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { router } from '@/router';
// Imported for its side effect: initialises i18next before anything renders, so
// the first paint is already in the right language.
import '@/i18n';
import './index.css';

initTelegram();
watchConnection();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Both sit outside the router: a connection drop or an error toast has to
          survive navigation, and neither belongs to any one screen. */}
      <ConnectionBanner />
      <Toaster />
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

// Two frames, not one: after `render` returns React has committed to the DOM but
// the browser has not yet painted it. Dismissing here would fade the splash out
// over a blank screen. The second rAF fires once the app's first frame is up.
requestAnimationFrame(() => requestAnimationFrame(dismissSplash));
