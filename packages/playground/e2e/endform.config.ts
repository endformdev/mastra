import { defineEndformConfig } from 'endform';

export default defineEndformConfig({
  // ARIA snapshots are read from disk rather than imported by the specs.
  additionalFiles: ['tests/**/*.aria.yml', '../tsconfig.json', 'kitchen-sink/.mastra/output/studio/**/*'],
  // Each remote runner owns its application. Endform schedules the whole suite.
  concurrentTestLimits: [
    {
      scope: 'within-suite-run',
      limit: Number(process.env.E2E_CONCURRENCY || 20),
    },
    { scope: 'within-suite-run', label: 'tag:@streaming', limit: 4 },
    { scope: 'within-suite-run', label: 'tag:@filesystem', limit: 1 },
  ],
});
