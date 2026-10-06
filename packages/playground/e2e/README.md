# Studio browser tests on Endform

Build the relevant workspace dependencies, then run:

```sh
pnpm --filter @internal/playground test:e2e
```

The command installs kitchen-sink dependencies and runs the existing 335 Chromium
cases once on Endform. All applications run locally on the machine running the
CLI. Endform provides the remote browsers and proxies HTTP, streaming and
WebSocket traffic back to the assigned local ports. There is no CI shard matrix.

The local application pool starts the supported `mastra dev` command once to
produce the native generated entrypoint, Studio assets and package metadata.
Each pool slot runs that entrypoint in a separate Node process, with its own
source tree and database working directory. Studio assets are immutable and
shared locally. Application configuration, Node environment and runtime directory
layout follow the native CLI startup path. Nothing starts an application inside
the remote Playwright worker, and Studio/server dependencies are not transferred
to remote machines.

The automatic fixture leases a slot for the whole attempt, including test hooks.
Browser and API request contexts use the slot's base URL. Existing Node fetch
helpers targeting the configured test origin are redirected to the same slot.
The control server only allocates leases; application traffic goes directly
through Endform's proxy to the application's port, without a gateway forwarding
hop. Explicit browser contexts in streaming/IME journeys use the same slot.
The existing MCP server call to localhost:4111 is mapped back to its own slot.

With `E2E_WARM_APPS=true`, successful ordinary tests return their slot after
running the native storage-reset endpoint. The application stays warm, matching
the native suite's reuse between tests. Failed attempts, filesystem cases,
workflow journeys, agent-builder journeys and CMS agent journeys stop the process,
restore its source/database, and restart before reuse. `E2E_WARM_APPS=false`
restarts every attempt. A failed reset removes the slot from circulation. A
crashed remote attempt's lease expires after three minutes and is restarted.
The fixture has a separate 60-second infrastructure budget; assertions, journey
timeouts, skip declarations and retries remain unchanged.

Tune host capacity and scheduling together:

```sh
E2E_WARM_APPS=true E2E_APP_POOL_SIZE=16 E2E_CONCURRENCY=16 E2E_STREAMING_CONCURRENCY=12 \
  pnpm --filter @internal/playground test:e2e:endform
```

Defaults are eight applications, eight concurrent tests and a streaming cap of
12 (which has no additional effect when the total limit is eight). The effective Endform limit is capped at local application capacity; increasing
the requested concurrency does not create additional applications. All matching native Endform concurrency limits apply.
The single filesystem case remains tagged with limit one; it adds no restriction
beyond that case being the only one with the tag. CI's manual workflow exposes
application, total and streaming limits, plus warm reuse, as inputs for measured experiments.

The native runner remains available as `test:e2e:playwright`, with its original
shared development server and one worker, including the separate Studio
base-path test outside this benchmark. Native UI/debugging scripts are preserved.
The common fixture chooses local leases only when `E2E_LOCAL_APP=true`, set by
the Endform script. Remote fixture alias imports use the explicit playground
tsconfig; runtime ARIA snapshots and tsconfig are transferred separately.

Check real state isolation before browser experiments:

```sh
node --test local-app-pool.test.mjs local-app-pool.integration.test.mjs
```

Report application preparation, test-stage wall time, outcomes, host CPU/memory
and concurrency together. Local Mac results are not an equivalent benchmark to
four-core GitHub-hosted CI. Every full-suite run must account for all 335 cases,
including the existing skips; a focused passing probe is not suite success.
GitHub CI authenticates with job-scoped OIDC; no API key is added.

Proxy transport and asset-cache probes did not establish an improvement. The
final setup uses HTTP host interception without an additional raw-port tunnel or
remote Studio cache. Failed experimental variants are recorded with the fork PR.
Completed proxy runs have not met the sub-five-minute target; performance and
reliability require further work rather than weakening assertions or retries.
