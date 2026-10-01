import { test as base } from '@playwright/test';

// Native Playwright keeps its existing dev server. Endform starts an isolated
// application in the remote test process, beside its browser.
export const test = process.env.E2E_REMOTE_APP === 'true' ? (await import('./remote-test')).remoteTest : base;

export { expect } from '@playwright/test';
