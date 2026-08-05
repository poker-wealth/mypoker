import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { initTelegram } from '@/lib/telegram';
import { router } from '@/router';
// Imported for its side effect: initialises i18next before anything renders, so
// the first paint is already in the right language. Safe this early because
// telegram-web-app.js is a blocking script in <head>, so window.Telegram.WebApp
// — where the player's language comes from — exists before this bundle runs.
import '@/i18n';
import './index.css';

initTelegram();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
