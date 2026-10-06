import { defineEndformConfig } from 'endform';

const port = Number(process.env.E2E_PORT || 4111);
const capacity = Number(process.env.E2E_APP_POOL_SIZE || 8);

export default defineEndformConfig({
  additionalFiles: ['tests/**/*.aria.yml', '../tsconfig.json'],
  // Applications stay on the CLI host; only browser/test code is distributed.
  proxyNetworkHosts: ['<loopback>'],
  proxyNetworkPorts: [port, ...Array.from({ length: capacity }, (_, index) => port + 1000 + index)],
  concurrentTestLimits: [
    { scope: 'within-suite-run', limit: Number(process.env.E2E_CONCURRENCY || capacity) },
    { scope: 'within-suite-run', label: 'tag:@streaming', limit: Number(process.env.E2E_STREAMING_CONCURRENCY || 12) },
    { scope: 'within-suite-run', label: 'tag:@filesystem', limit: 1 },
  ],
});
