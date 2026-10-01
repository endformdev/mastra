# Studio browser tests on Endform

Run the existing suite from this directory after building the workspace dependencies
and installing `kitchen-sink` dependencies:

```sh
E2E_APP_POOL_SIZE=8 npx endform@latest test --organization-id 2G1ZCj7X
```

The fork workflow runs this command once, without a shard matrix. Endform schedules
all 335 Chromium tests. `E2E_APP_POOL_SIZE` controls both application capacity and
the Endform concurrency limit (default 4, supported range 1–16).

Tests import `test` and `expect` from `tests/__utils__/test`. Its automatic fixture
leases one kitchen-sink instance for the whole test attempt, including hooks. The
lease header is attached to browser contexts, API request contexts and Node fetch
calls to the test origin. Existing test URLs and assertions stay unchanged.

`isolation-server.mjs` runs `mastra dev` once to generate the development server
and Studio, then starts isolated copies of that output behind one gateway. Each
instance has its own database, source tree and process. After every attempt, the
instance is stopped, its database and source tree are reset, and it is restarted
before another test can lease it. This also isolates tests that save agent
configuration to disk. Dependency builds and browser installation are not
repeated per application instance; Endform provides the browsers.

The gateway refuses application requests without an active lease. Do not bypass
it by calling a backend port, or remove a reset to increase concurrency. A hung
or failing instance is not returned to the pool. The server is a local test
harness, not a production application service.

Playwright explicitly uses the playground `tsconfig.json` so imported fixtures
retain their `@/*` mappings on remote runners. ARIA snapshot files are transferred
explicitly because tests read them at runtime.

Verify the lease and reset behavior before browser experiments:

```sh
node --test isolation-server.test.mjs
```

For targeted experiments, use Endform's normal Playwright file or grep filters;
do not replace full-suite verification with a smaller passing subset. Changing
pool size changes application capacity, so report it with benchmark results.
