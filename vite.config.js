import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/<repo>/ whatever the repo is called.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
