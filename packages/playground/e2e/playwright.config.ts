import { defineConfig, devices, PlaywrightTestConfig } from '@playwright/test';

const PORT = process.env.E2E_PORT;
const BASE_URL = `http://localhost:${PORT || '4111'}`;

const webservers: PlaywrightTestConfig['webServer'] = [
  {
    // UI tests use route interception for auth mocking - no server auth needed
    // Server-side permission tests are in server-adapters/hono
    command: 'node ./isolation-server.mjs',
    url: `${BASE_URL}/__e2e/health`,
    timeout: 120_000,
  },
];

export default defineConfig({
  tsconfig: '../tsconfig.json',
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'html',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    reducedMotion: 'reduce',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: process.env.E2E_REMOTE_APP === 'true' ? undefined : webservers,
});
