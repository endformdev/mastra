import { randomUUID } from 'node:crypto';
import { test as base } from '@playwright/test';

const BASE_URL = `http://localhost:${process.env.E2E_PORT || '4111'}`;
const SESSION_HEADER = 'x-mastra-e2e-session';
const SESSION_ANNOTATION = 'mastra-e2e-session';

// Node fetch helpers and browser/APIRequestContext traffic must use the same lease.
// Resolve the annotation per call rather than storing mutable process-wide test state.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (process.env.E2E_REMOTE_APP === 'true') return originalFetch(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== BASE_URL || url.pathname.startsWith('/__e2e/')) return originalFetch(input, init);
  const session = base.info().annotations.find(annotation => annotation.type === SESSION_ANNOTATION)?.description;
  if (!session) throw new Error('Kitchen-sink request made without an isolated test session');
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set(SESSION_HEADER, session);
  return originalFetch(input, { ...init, headers });
};

const isolatedTest = base.extend<{ isolatedSession: string }>({
  isolatedSession: [
    async ({ browser }, use, testInfo) => {
      const session = randomUUID();
      const headers = { [SESSION_HEADER]: session };
      const response = await originalFetch(`${BASE_URL}/__e2e/lease`, { method: 'POST', headers });
      if (!response.ok) throw new Error(`Could not lease kitchen-sink: ${response.status}`);
      testInfo.annotations.push({ type: SESSION_ANNOTATION, description: session });
      // Existing streaming/IME specs create contexts explicitly. Browser is a
      // worker fixture, so patch only for this test attempt and restore on exit.
      const newContext = browser.newContext.bind(browser);
      browser.newContext = options =>
        newContext({
          ...options,
          extraHTTPHeaders: { ...options?.extraHTTPHeaders, [SESSION_HEADER]: session },
        });
      try {
        await use(session);
      } finally {
        browser.newContext = newContext;
        const release = await originalFetch(`${BASE_URL}/__e2e/lease`, { method: 'DELETE', headers });
        if (!release.ok) throw new Error(`Could not reset kitchen-sink: ${release.status}`);
      }
    },
    { auto: true },
  ],
  extraHTTPHeaders: async ({ isolatedSession, extraHTTPHeaders }, use) => {
    await use({ ...extraHTTPHeaders, [SESSION_HEADER]: isolatedSession });
  },
});

export const test = process.env.E2E_REMOTE_APP === 'true' ? (await import('./remote-test')).remoteTest : isolatedTest;

export { expect } from '@playwright/test';
