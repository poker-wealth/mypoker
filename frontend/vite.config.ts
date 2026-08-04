import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// The Telegram Mini App loads over HTTPS from Netlify, served from the domain root.
//
// `base` must be absolute. With a relative './', a hard load of a nested route like
// /table/tx-1 resolves './assets/app.js' to '/table/assets/app.js', which the SPA
// fallback answers with index.html — and `nosniff` then stops the browser executing
// it, so the page comes up blank. Only client-side navigation would work.
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
});
