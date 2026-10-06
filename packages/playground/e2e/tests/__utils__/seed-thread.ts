import { testOrigin } from './test-origin';

/** Seeds a weather-agent thread with `count` user messages "seed message 0..count-1", oldest first. */
export const seedThread = async (threadId: string, count: number) => {
  const res = await fetch(`${testOrigin()}/e2e/seed-thread`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ threadId, count }),
  });
  if (!res.ok) {
    throw new Error(`Failed to seed thread "${threadId}": ${res.status} ${res.statusText}`);
  }
};
