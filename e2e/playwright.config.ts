import { defineConfig, devices } from '@playwright/test';
import { DEMO_PORT, DESKTOP_PORT, SERVER_PORT } from './ports';

// End-to-end tests: real browser, real server, throwaway databases (see global-setup.ts).
//   npm test                      run everything
//   npm test -- --project=desktop only the desktop-app suite
//   npm test -- --project=demo    only the website demo
//   E2E_SKIP_BUILD=1 npm test     reuse the client builds from this checkout's last run
//   E2E_PORT_BASE=3271 npm test   other ports, to run next to another checkout's run (ports.ts)
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
  // Folders are matched as tests/<name>/, so a checkout path containing "phone" or
  // "server-mode" can't pull every test into the wrong project
  projects: [
    {
      name: 'desktop',
      testIgnore: /\/tests\/(server-mode|phone|demo)\//,
      use: { baseURL: `http://localhost:${DESKTOP_PORT}` },
    },
    // The desktop app's pages on a phone-sized screen (iPhone 13/14: 390×844)
    {
      name: 'phone',
      testMatch: /\/tests\/phone\/.*\.spec\.ts$/,
      use: {
        baseURL: `http://localhost:${DESKTOP_PORT}`,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    // The website's in-browser demo: the app with its API in a Web Worker, on a sample budget
    {
      name: 'demo',
      testMatch: /\/tests\/demo\/.*\.spec\.ts$/,
      use: { baseURL: `http://localhost:${DEMO_PORT}` },
    },
    {
      name: 'server-mode',
      testMatch: /\/tests\/server-mode\/.*\.spec\.ts$/,
      use: { baseURL: `http://localhost:${SERVER_PORT}` },
    },
  ],
});
