import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/<repo>/ whatever the repo is called.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  // Agent worktrees live in .claude/; don't run their copies of the tests.
  // Some simulation sweeps take 2-4 s on their own, so a busy full run outgrew the 5 s default.
  test: { exclude: ['**/node_modules/**', '.claude/**'], testTimeout: 20000 },
});
