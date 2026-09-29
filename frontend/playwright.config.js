import { defineConfig, devices } from '@playwright/test';

// Browser tests against a real server (e2e/serve.mjs) and the built app: run
// `npm run build` first, then `npm run test:e2e`. The setup test runs first and creates the
// admin account and library every other test uses.
const port = process.env.E2E_PORT || '18090';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 60_000,
    reuseExistingServer: false,
    stdout: 'pipe'
  },
  projects: [
    { name: 'setup', testMatch: /setup\.spec\.js/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'phone',
      testMatch: /.*\.spec\.js/,
      testIgnore: /setup\.spec\.js/,
      dependencies: ['setup'],
      use: { ...devices['iPhone 13'], browserName: 'chromium' }
    }
  ]
});
