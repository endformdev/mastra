import { defineEndformConfig } from 'endform';

export default defineEndformConfig({
  // ARIA snapshots are read from disk rather than imported by the specs.
  additionalFiles: ['tests/**/*.aria.yml'],
  // Tests clear the whole kitchen-sink database, so each application must serve
  // one test at a time. CI retains four disjoint shards with isolated servers.
  concurrentTestLimits: [{ scope: 'within-suite-run', limit: 1 }],
});
