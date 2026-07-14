// Smoke-test config. Serves the repo as-is over a local static server —
// the same files Vercel serves — so the suite validates LOCAL code before
// a push, with no build step and no writes to production data (the fake
// test session's JWT is rejected by Supabase RLS on any real call).
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  workers: 4,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8788',
    viewport: { width: 390, height: 844 }, // mobile-first, like the staff phones
  },
  webServer: {
    command: 'python3 -m http.server 8788 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8788/',
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
