import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * What the app shows next to its name, so you can tell at a glance whether
 * the copy in front of you is the one you just deployed.
 *
 * The version comes from package.json, the date from the build, and the
 * commit from git when it is there — GitHub Actions builds in a checkout,
 * so it is. A build from a zip with no git still works; it just says
 * "unknown" for the commit.
 */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    // Date only: a time would suggest a precision that a cached app does
    // not have anyway.
    __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __APP_COMMIT__: JSON.stringify(gitCommit()),
  },
  // Relative base so the built bundle also works when loaded from a file://
  // style container (Capacitor's Android WebView, a Tauri bundle).
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
