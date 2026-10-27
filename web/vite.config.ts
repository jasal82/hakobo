// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';

// Im Entwicklungsmodus leitet Vite API-Anfragen an das laufende
// Rust-Backend weiter (`cargo run -- --no-open --token dev`).
const backend = process.env.HAKOBO_BACKEND ?? 'http://127.0.0.1:4590';
// Token des Entwicklungsservers (`--token dev`), damit die API ohne Anmeldung antwortet.
const token = process.env.HAKOBO_DEV_TOKEN ?? 'dev';

export default defineConfig({
  plugins: [
    react(),
    {
      // rust-embed braucht den Ordner schon vor dem ersten Build.
      name: 'keep-dist',
      closeBundle() {
        writeFileSync('dist/.keep', '');
      },
    },
  ],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: backend,
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (req) => req.setHeader('Authorization', `Bearer ${token}`));
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
  },
});
