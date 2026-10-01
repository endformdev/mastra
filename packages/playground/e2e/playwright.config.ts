import { defineConfig, devices, PlaywrightTestConfig } from '@playwright/test';

const PORT = process.env.E2E_PORT;
const BASE_URL = `http://localhost:${PORT || '4111'}`;

const webservers: PlaywrightTestConfig['webServer'] = [
  {
    // UI tests use route interception for auth mocking - no server auth needed
    // Server-side permission tests are in server-adapters/hono
    command: 'pnpm -C ./kitchen-sink dev',
    url: 'http://localhost:4111',
    timeout: 120_000,
  },
];

if (PORT) {
  webservers.push({
    command: `echo "App is running on :${PORT}"`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: true,
  });
}

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
