import { defineEndformConfig } from 'endform';

const capacity = Number(process.env.E2E_APP_POOL_SIZE || 8);

export default defineEndformConfig({
  additionalFiles: ['tests/**/*.aria.yml', '../tsconfig.json'],
  // Browser, Node fetch, SSE and WebSocket traffic returns to the CLI host.
  proxyNetworkHosts: ['<loopback>'],
  concurrentTestLimits: [
    { scope: 'within-suite-run', limit: Math.min(Number(process.env.E2E_CONCURRENCY || capacity), capacity) },
    { scope: 'within-suite-run', label: 'tag:@streaming', limit: Number(process.env.E2E_STREAMING_CONCURRENCY || 12) },
    { scope: 'within-suite-run', label: 'tag:@filesystem', limit: 1 },
  ],
});
