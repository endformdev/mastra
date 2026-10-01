import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startIsolatedApps } from './isolation-server.mjs';

// Generate Studio assets with the supported dev command; no app pool is retained.
const prepared = await startIsolatedApps({
  size: 0,
  port: 4111,
  kitchenSink: join(dirname(fileURLToPath(import.meta.url)), 'kitchen-sink'),
});
await prepared.close();
