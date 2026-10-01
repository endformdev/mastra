import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base } from '@playwright/test';
import { createNodeServer } from '../../../../deployer/dist/server/index.js';

// Endform gives each test its own remote runner. Start the existing kitchen-sink
// application there, so resets and source writes cannot affect other tests.
export const remoteTest = base.extend<{ isolatedApplication: void }>({
  isolatedApplication: [
    async ({}, use) => {
      const oldDirectory = process.cwd();
      const directory = await mkdtemp(join(tmpdir(), 'mastra-remote-test-'));
      const environment = {
        MASTRA_DEV: process.env.MASTRA_DEV,
        MASTRA_STUDIO_PATH: process.env.MASTRA_STUDIO_PATH,
        MASTRA_PROJECT_ROOT: process.env.MASTRA_PROJECT_ROOT,
        PORT: process.env.PORT,
      };
      let server: Awaited<ReturnType<typeof createNodeServer>> | undefined;
      let shutdown: (() => Promise<void>) | undefined;
      try {
        process.chdir(directory);
        process.env.MASTRA_DEV = 'true';
        process.env.PORT = process.env.E2E_PORT || '4111';
        process.env.MASTRA_STUDIO_PATH = fileURLToPath(
          new URL('../../kitchen-sink/.mastra/output/studio', import.meta.url),
        );
        await mkdir(join(directory, '.mastra'), { recursive: true });
        await cp(fileURLToPath(new URL('../../kitchen-sink/src', import.meta.url)), join(directory, 'src'), {
          recursive: true,
        });
        process.env.MASTRA_PROJECT_ROOT = join(directory, '.mastra');
        const { mastra } = await import('../../kitchen-sink/src/mastra/index');
        const tools = await import('../../kitchen-sink/src/mastra/tools');
        shutdown = () => mastra.shutdown();
        // Mastra dev emits a CLI readiness message over process.send. This process
        // belongs to Playwright, so keep that message out of its worker IPC protocol.
        const send = process.send;
        if (send) {
          process.send = ((message, ...args) => {
            if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'server-ready')
              return true;
            return Reflect.apply(send, process, [message, ...args]);
          }) as typeof process.send;
        }
        try {
          // The server's public type erases tool input/output generics; these
          // are the same schema-backed exports passed by the development CLI.
          server = await createNodeServer(mastra, {
            studio: true,
            isDev: true,
            tools,
          } as NonNullable<Parameters<typeof createNodeServer>[1]>);
          // createNodeServer resolves before its listen callback emits readiness.
          // Keep the IPC guard until a health request proves that callback ran.
          const ready = await fetch(`http://localhost:${process.env.PORT}/health`);
          if (!ready.ok) throw new Error(`Kitchen-sink health check failed: ${ready.status}`);
        } finally {
          process.send = send;
        }
        await use();
      } finally {
        try {
          if (server) {
            if ('closeAllConnections' in server) server.closeAllConnections();
            const runningServer = server;
            await new Promise<void>((resolve, reject) =>
              runningServer.close(error => (error ? reject(error) : resolve())),
            );
          }
          await shutdown?.();
        } finally {
          for (const [name, value] of Object.entries(environment)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
          }
          process.chdir(oldDirectory);
          await rm(directory, { recursive: true, force: true });
        }
      }
    },
    // Infrastructure setup/teardown has its own budget; existing journeys keep
    // their original test and assertion timeouts.
    { auto: true, timeout: 60_000 },
  ],
});
