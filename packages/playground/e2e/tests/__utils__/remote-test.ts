import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base } from '@playwright/test';
import { createNodeServer } from '../../../../deployer/dist/server/index.js';

// Experimental mode: Endform gives each parallel test its own remote runner.
// Put the application next to its browser rather than proxying to a shared CI host.
export const remoteTest = base.extend<{ isolatedSession: string }>({
  isolatedSession: [
    async ({}, use) => {
      const oldDirectory = process.cwd();
      const directory = await mkdtemp(join(tmpdir(), 'mastra-remote-test-'));
      process.chdir(directory);
      process.env.MASTRA_DEV = 'true';
      process.env.MASTRA_STUDIO_PATH = fileURLToPath(
        new URL('../../kitchen-sink/.mastra/output/studio', import.meta.url),
      );
      await mkdir(join(directory, '.mastra'), { recursive: true });
      await cp(fileURLToPath(new URL('../../kitchen-sink/src', import.meta.url)), join(directory, 'src'), {
        recursive: true,
      });
      process.env.MASTRA_PROJECT_ROOT = join(directory, '.mastra');
      delete process.env.E2E_GATEWAY_PORT;
      const { mastra } = await import('../../kitchen-sink/src/mastra/index');
      const tools = await import('../../kitchen-sink/src/mastra/tools');
      // Mastra dev emits a CLI readiness message over process.send. This process
      // belongs to Playwright, so keep that message out of its worker IPC protocol.
      const send = process.send;
      if (send) {
        process.send = ((message, ...args) => {
          if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'server-ready')
            return true;
          return send.call(process, message, ...args);
        }) as typeof process.send;
      }
      const server = await createNodeServer(mastra, { studio: true, isDev: true, tools });
      await fetch('http://localhost:4111/health');
      process.send = send;
      try {
        await use('remote');
      } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        await mastra.shutdown();
        process.chdir(oldDirectory);
        await rm(directory, { recursive: true, force: true });
      }
    },
    { auto: true, timeout: 60_000 },
  ],
});
