# Studio browser tests on Endform

After building the workspace dependencies, run:

```sh
pnpm --filter @internal/playground test:e2e
```

This installs the kitchen-sink dependencies, generates Studio assets once using
its supported `mastra dev` command, and runs one Endform command for the existing
335 Chromium tests. Endform supplies the browsers. CI uses the same path after
its workspace build and frozen fixture installation; there is no shard matrix.
`test:e2e:endform` skips the dependency installation.

Each Endform test runs on its own remote machine. The automatic fixture in
`tests/__utils__/remote-test.ts` starts the existing kitchen-sink application using
Mastra's Node server and the same agents, tools, storage and workflow definitions.
It gives that attempt a temporary database directory and source tree. Browser,
API request context and Node fetch traffic stays on that machine's localhost.
The server, storage and temporary files are cleaned up after the attempt.
Retries run in fresh Playwright workers. The application starts before test hooks
and has a separate 60-second infrastructure budget; existing test bodies,
assertions, assertion timeouts and retry policy remain unchanged.

The default Endform concurrency limit is 20. Override it for experiments with:

```sh
E2E_CONCURRENCY=40 pnpm --filter @internal/playground test:e2e:endform
```

`concurrentTestLimits` also caps `@streaming` tests at four concurrent attempts
and the single `@filesystem` test at one. All matching limits apply; these are
scheduling limits, not test filters. The filesystem cap currently adds no extra
restriction because only one test has that tag. Limits apply within each suite
run because applications are isolated across runs too.

The native runner is available as `test:e2e:playwright`, including its separate
Studio base-path test, which is outside this benchmark. It uses the original
shared development server and one Playwright worker. `test:e2e:ui` and the other
native debugging scripts remain available. The common fixture chooses the
remote application only when `E2E_REMOTE_APP=true`, set by the Endform script.

Playwright explicitly uses the playground `tsconfig.json` so imported fixtures
retain their `@/*` mappings on remote runners. Endform transfers imports and
directly referenced environment variables automatically. ARIA snapshots,
`tsconfig.json` and generated Studio assets are transferred explicitly because
these are runtime file reads. There is no broad environment capture or API key.
The fork CI job authenticates through GitHub OIDC.

Full-suite experiments compared a shared CI application pool of 8 and 16
instances with applications on Endform runners. The pool saturated the CI host
and was removed from the final setup. Runner-local execution reduced measured
feedback time, but completed runs still contain assertion and timing failures.
Those failures stay visible; this is not a passing migration yet. See the fork
PR for exact commits, completed runs, outcomes and timing comparisons. Do not
use a smaller passing subset to represent the full suite.
