import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function createLeaseServer(apps, { leaseMilliseconds = 180_000 } = {}) {
  const available = [...apps];
  const sessions = new Map();
  const waiting = [];
  const metrics = {
    leases: 0,
    maxActive: 0,
    resets: 0,
    resetMilliseconds: 0,
    expired: 0,
    resetFailures: 0,
    warmResets: 0,
    restartResets: 0,
  };
  let closing = false;
  const returnApp = app => {
    if (closing) return;
    const pending = waiting.shift();
    if (pending) pending.allocate(app);
    else available.push(app);
  };
  const reset = async (app, forceRestart = true) => {
    const started = Date.now();
    try {
      const kind = await app.reset(forceRestart);
      if (kind === 'warm') metrics.warmResets++;
      else metrics.restartResets++;
      metrics.resets++;
      metrics.resetMilliseconds += Date.now() - started;
      returnApp(app);
    } catch (error) {
      metrics.resetFailures++;
      throw error;
    }
  };
  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/__e2e/health')
      return send(200, { instances: apps.length, available: available.length, ...metrics });
    if (req.url !== '/__e2e/lease') return send(404, { error: 'Control server does not forward application traffic' });
    const id = req.headers['x-mastra-e2e-session'];
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) return send(400, { error: 'Session required' });
    if (req.method === 'POST') {
      if (closing) return send(503, { error: 'Pool is closing' });
      if (sessions.has(id)) return send(409, { error: 'Session already leased' });
      const allocate = app => {
        sessions.set(id, { app, expires: Date.now() + leaseMilliseconds });
        metrics.leases++;
        metrics.maxActive = Math.max(metrics.maxActive, sessions.size);
        send(201, { baseURL: `http://localhost:${app.port}` });
      };
      const app = available.shift();
      if (app) allocate(app);
      else {
        const pending = { allocate };
        waiting.push(pending);
        res.on('close', () => {
          const index = waiting.indexOf(pending);
          if (index >= 0) waiting.splice(index, 1);
        });
      }
      return;
    }
    if (req.method === 'DELETE') {
      const session = sessions.get(id);
      if (!session) return send(404, { error: 'Unknown session' });
      sessions.delete(id);
      try {
        await reset(session.app, req.headers['x-mastra-e2e-restart'] !== 'false');
        send(200, { released: true });
      } catch (error) {
        send(500, { error: `Application reset failed: ${error.message}` });
      }
      return;
    }
    send(405, { error: 'Method not allowed' });
  });
  const reap = setInterval(
    () => {
      for (const [id, session] of sessions) {
        if (session.expires > Date.now()) continue;
        sessions.delete(id);
        metrics.expired++;
        void reset(session.app).catch(error => console.error(`Expired lease reset failed: ${error.message}`));
      }
    },
    Math.min(1000, leaseMilliseconds),
  );
  reap.unref();
  server.on('close', () => {
    closing = true;
    clearInterval(reap);
  });
  return Object.assign(server, { isolationMetrics: metrics });
}

async function stop(child, group = false) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  const kill = signal => {
    try {
      if (group) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  kill('SIGTERM');
  const timeout = setTimeout(() => kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}

async function ready(port, child) {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Application on :${port} exited`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Application on :${port} did not become ready`);
}

export async function startLocalApps({ size, port = 4111, kitchenSink, generate = true }) {
  const root = await mkdtemp(join(tmpdir(), 'mastra-local-pool-'));
  const apps = [];
  let template;
  try {
    // Generate exactly the entrypoint and package metadata used by native CI.
    if (generate) {
      template = spawn('pnpm', ['dev'], {
        cwd: kitchenSink,
        detached: true,
        env: { ...process.env, PORT: String(port + 100) },
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      await ready(port + 100, template);
      await stop(template, true);
      template = undefined;
    }
    const generated = join(kitchenSink, '.mastra/output');
    const prepare = async index => {
      const directory = join(root, String(index));
      const output = join(directory, '.mastra/output');
      await mkdir(directory, { recursive: true });
      await cp(generated, output, {
        recursive: true,
        filter: source => source !== join(generated, 'studio') && source !== join(generated, 'public'),
      });
      // Immutable Studio assets are shared locally, never uploaded to test VMs.
      await symlink(join(generated, 'studio'), join(output, 'studio'));
      await symlink(join(kitchenSink, 'node_modules'), join(directory, 'node_modules'));
      await cp(join(kitchenSink, 'package.json'), join(directory, 'package.json'));
      const packagesFile = join(directory, '.mastra/mastra-packages.json');
      await cp(join(kitchenSink, '.mastra/mastra-packages.json'), packagesFile);
      const app = { port: port + 1000 + index, child: undefined };
      const publicDir = join(directory, 'src/mastra/public');
      app.reset = async (forceRestart = true) => {
        if (
          process.env.E2E_WARM_APPS === 'true' &&
          !forceRestart &&
          app.child?.exitCode === null &&
          app.child.signalCode === null
        ) {
          const response = await fetch(`http://127.0.0.1:${app.port}/e2e/reset-storage`, {
            method: 'POST',
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) throw new Error(`Storage reset failed: ${response.status}`);
          return 'warm';
        }
        await stop(app.child);
        await rm(join(directory, 'src'), { recursive: true, force: true });
        await cp(join(kitchenSink, 'src'), join(directory, 'src'), {
          recursive: true,
          filter: source => source !== join(kitchenSink, 'src/mastra/public'),
        });
        await mkdir(publicDir, { recursive: true });
        app.child = spawn(
          process.execPath,
          [join(dirname(fileURLToPath(import.meta.url)), 'local-app.mjs'), join(output, 'index.mjs')],
          {
            cwd: publicDir,
            env: {
              ...process.env,
              NODE_ENV: 'production',
              MASTRA_DEV: 'true',
              PORT: String(app.port),
              MASTRA_PROJECT_ROOT: join(directory, '.mastra'),
              MASTRA_PACKAGES_FILE: packagesFile,
              MASTRA_TELEMETRY_COMMAND: 'dev',
              E2E_CONTROL_PORT: String(port),
            },
            stdio: ['ignore', 'inherit', 'inherit'],
          },
        );
        await ready(app.port, app.child);
        return 'restart';
      };
      apps.push(app);
      await app.reset();
    };
    // Avoid starting every Node process at once on a small CI host.
    for (let index = 0; index < size; index += 4) {
      await Promise.all(Array.from({ length: Math.min(4, size - index) }, (_, offset) => prepare(index + offset)));
    }
    return {
      apps,
      close: async () => {
        await Promise.all(apps.map(app => stop(app.child)));
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await stop(template, true);
    await Promise.all(apps.map(app => stop(app.child)));
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.E2E_PORT || 4111);
  const size = Number(process.env.E2E_APP_POOL_SIZE || 8);
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error('E2E_APP_POOL_SIZE must be 1–100');
  const pool = await startLocalApps({
    size,
    port,
    kitchenSink: join(dirname(fileURLToPath(import.meta.url)), 'kitchen-sink'),
  });
  const leases = createLeaseServer(pool.apps);
  await new Promise(resolve => leases.listen(port, '127.0.0.1', resolve));
  console.error(`Local applications ready: ${size}, control port ${port}`);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.error(`Local application metrics: ${JSON.stringify(leases.isolationMetrics)}`);
    leases.closeAllConnections();
    await new Promise(resolve => leases.close(resolve));
    await pool.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
