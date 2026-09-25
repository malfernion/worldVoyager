import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/<repo>/ whatever the repo is called.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  // Agent worktrees live in .claude/; don't run their copies of the tests.
  test: { exclude: ['**/node_modules/**', '.claude/**'] },
});
