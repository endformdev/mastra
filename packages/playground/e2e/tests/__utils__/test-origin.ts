import { test } from '@playwright/test';

export function testOrigin() {
  if (process.env.E2E_LOCAL_APP === 'true') {
    const origin = test.info().annotations.find(annotation => annotation.type === 'mastra-e2e-app-url')?.description;
    if (!origin) throw new Error('Kitchen-sink helper called without an application lease');
    return origin;
  }
  return `http://localhost:${process.env.E2E_PORT || '4111'}`;
}
