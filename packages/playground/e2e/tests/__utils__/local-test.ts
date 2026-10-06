import { randomUUID } from 'node:crypto';
import { test as base } from '@playwright/test';

const CONTROL_URL = `http://localhost:${process.env.E2E_PORT || '4111'}`;
const APP_ANNOTATION = 'mastra-e2e-app-url';
const originalFetch = globalThis.fetch;

// Preserve existing helpers that seed/reset the configured localhost origin.
// Each attempt redirects those calls to its assigned local application port.
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== CONTROL_URL || url.pathname.startsWith('/__e2e/')) return originalFetch(input, init);
  const target = base.info().annotations.find(annotation => annotation.type === APP_ANNOTATION)?.description;
  if (!target) throw new Error('Kitchen-sink request made without an application lease');
  const redirect = new URL(url.pathname + url.search, target);
  return originalFetch(input instanceof Request ? new Request(redirect, input) : redirect, init);
};

export const localTest = base.extend<{ appLease: string }>({
  appLease: [
    async ({ browser }, use, testInfo) => {
      const headers = { 'x-mastra-e2e-session': randomUUID() };
      const lease = await originalFetch(`${CONTROL_URL}/__e2e/lease`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(55_000),
      });
      if (!lease.ok) throw new Error(`Application lease failed: ${lease.status}`);
      const { baseURL } = (await lease.json()) as { baseURL: string };
      testInfo.annotations.push({ type: APP_ANNOTATION, description: baseURL });
      const newContext = browser.newContext.bind(browser);
      // Streaming and IME journeys also create browser contexts explicitly.
      browser.newContext = options => newContext({ ...options, baseURL });
      try {
        await use(baseURL);
      } finally {
        browser.newContext = newContext;
        const requiresFreshProcess =
          testInfo.status !== testInfo.expectedStatus ||
          testInfo.tags.includes('@filesystem') ||
          /\/(workflows|agent-builder|cms\/agents)\//.test(testInfo.file);
        const released = await originalFetch(`${CONTROL_URL}/__e2e/lease`, {
          method: 'DELETE',
          headers: { ...headers, 'x-mastra-e2e-restart': String(requiresFreshProcess) },
        });
        if (!released.ok) throw new Error(`Application reset failed: ${released.status}`);
      }
    },
    { auto: true, timeout: 60_000 },
  ],
  baseURL: async ({ appLease }, use) => use(appLease),
});
