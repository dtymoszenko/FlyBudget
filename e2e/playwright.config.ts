import { defineConfig, devices } from '@playwright/test';
import { DESKTOP_PORT, SERVER_PORT } from './ports';

// End-to-end tests: real browser, real server, throwaway databases (see global-setup.ts).
//   npm test                      run everything
//   npm test -- --project=desktop only the desktop-app suite
//   E2E_SKIP_BUILD=1 npm test     reuse the client builds from the last run
//   E2E_SERVER_LOGS=1 npm test    show the servers' logs

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // The desktop suite shares one database, reset before each test, so tests run one at a time
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1400, height: 900 },
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /server-mode\//,
      use: { baseURL: `http://localhost:${DESKTOP_PORT}` },
    },
    {
      name: 'server-mode',
      testMatch: /server-mode\/.*\.spec\.ts/,
      use: { baseURL: `http://localhost:${SERVER_PORT}` },
    },
  ],
});
