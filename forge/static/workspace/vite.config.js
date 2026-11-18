import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

// Custom UI is served from a Forge-hosted path, so every asset URL must be relative.
// `vite --mode mock` (npm run dev:mock) swaps @forge/bridge for a local stand-in so the UI runs in a plain browser.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  // The UI shares pure modules with the backend (forge/src/graph*.js).
  server: { fs: { allow: ['..', '../..'] } },
  resolve: mode === 'mock' ? { alias: { '@forge/bridge': fileURLToPath(new URL('./src/dev/mockBridge.js', import.meta.url)) } } : {},
}));
