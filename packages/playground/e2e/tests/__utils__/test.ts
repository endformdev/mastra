import { test as base } from '@playwright/test';

// Native Playwright keeps its existing dev server; Endform leases a local app
// and proxies directly to that app's port through the CLI.
export const test = process.env.E2E_LOCAL_APP === 'true' ? (await import('./local-test')).localTest : base;

export { expect } from '@playwright/test';
