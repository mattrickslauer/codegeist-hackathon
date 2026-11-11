import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Custom UI is served from a Forge-hosted path, so every asset URL must be relative.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});
