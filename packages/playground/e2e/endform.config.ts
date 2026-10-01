import { defineEndformConfig } from 'endform';

export default defineEndformConfig({
  // ARIA snapshots are read from disk rather than imported by the specs.
  additionalFiles: [
    'tests/**/*.aria.yml',
    '../tsconfig.json',
    ...(process.env.E2E_REMOTE_APP === 'true' ? ['kitchen-sink/.mastra/output/studio/**/*'] : []),
  ],
  // Each test leases an isolated application; Endform schedules the whole suite.
  concurrentTestLimits: [
    {
      scope: 'within-suite-run',
      limit: Number(
        process.env.E2E_REMOTE_APP === 'true' ? process.env.E2E_CONCURRENCY || 40 : process.env.E2E_APP_POOL_SIZE || 4,
      ),
    },
    { scope: 'within-suite-run', label: 'tag:@streaming', limit: 4 },
    { scope: 'within-suite-run', label: 'tag:@filesystem', limit: 1 },
  ],
});
