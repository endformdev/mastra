import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SESSION_HEADER = 'x-mastra-e2e-session';

// A lease covers one test attempt, including its hooks and browser/API requests.
// Each backend owns its database, source tree and in-memory Mastra registries.
export function createGateway(backends) {
  const sessions = new Map();
  const available = [...backends];
  const waiting = [];
  const server = createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.url === '/__e2e/health') return send(200, { instances: backends.length });
    if (req.url === '/__e2e/lease' && req.method === 'POST') {
      const session = req.headers[SESSION_HEADER];
      if (typeof session !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(session)) {
        return send(400, { error: 'A valid session header is required' });
      }
      if (sessions.has(session)) return send(409, { error: 'Session already leased' });
      const allocate = backend => {
        sessions.set(session, backend);
        send(201, { session });
      };
      const backend = available.shift();
      if (backend) allocate(backend);
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
    if (req.url === '/__e2e/lease' && req.method === 'DELETE') {
      const session = req.headers[SESSION_HEADER];
      const backend = sessions.get(session);
      if (!backend) return send(404, { error: 'Unknown session' });
      sessions.delete(session);
      // Reset after every attempt, even when a test has no afterEach reset or fails.
      // Filesystem changes require a fresh process/source tree as well as a database reset.
      try {
        await backend.reset();
        const pending = waiting.shift();
        if (pending) pending.allocate(backend);
        else available.push(backend);
        send(200, { released: true });
      } catch (error) {
        send(500, { error: `Could not reset isolated instance: ${error.message}` });
      }
      return;
    }
    const backend = sessions.get(req.headers[SESSION_HEADER]);
    if (!backend) return send(409, { error: 'Application requests require an active test lease' });
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: backend.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `localhost:${backend.port}` },
      },
      response => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', error => {
      if (!res.headersSent) send(502, { error: error.message });
      else res.destroy(error);
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('upgrade', (req, socket, head) => {
    const backend = sessions.get(req.headers[SESSION_HEADER]);
    if (!backend) return socket.destroy();
    const upstream = connect(backend.port, '127.0.0.1', () => {
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
      for (const [name, value] of Object.entries(req.headers)) {
        upstream.write(`${name}: ${value}\r\n`);
      }
      upstream.write('\r\n');
      upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });
  return server;
}

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (child.exitCode !== null) throw new Error(`Kitchen-sink exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Kitchen-sink on port ${port} did not become ready`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

export async function startIsolatedApps({ size, port, kitchenSink }) {
  const root = await mkdtemp(join(tmpdir(), 'mastra-endform-'));
  const backends = [];
  let templateProcess;
  try {
    // Use the supported dev command once to generate the development server and Studio.
    templateProcess = spawn('pnpm', ['dev'], {
      cwd: kitchenSink,
      detached: true,
      env: { ...process.env, PORT: String(port + 100), E2E_GATEWAY_PORT: String(port) },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    await waitForServer(port + 100, templateProcess);
    // pnpm owns a CLI and server process tree; terminate only this process group.
    process.kill(-templateProcess.pid, 'SIGTERM');
    await stop(templateProcess);
    templateProcess = undefined;
    for (let index = 0; index < size; index++) {
      const directory = join(root, String(index));
      const output = join(directory, '.mastra/output');
      await mkdir(directory, { recursive: true });
      await cp(join(kitchenSink, '.mastra/output'), output, { recursive: true });
      await symlink(join(kitchenSink, 'node_modules'), join(directory, 'node_modules'));
      await cp(join(kitchenSink, 'package.json'), join(directory, 'package.json'));
      await mkdir(join(output, 'public'), { recursive: true });
      const backend = { port: port + index + 1, child: undefined };
      const start = async () => {
        backend.child = spawn(process.execPath, [join(output, 'index.mjs')], {
          cwd: join(output, 'public'),
          env: {
            ...process.env,
            PORT: String(backend.port),
            E2E_GATEWAY_PORT: String(port),
            MASTRA_DEV: 'true',
            MASTRA_PROJECT_ROOT: join(directory, '.mastra'),
          },
          stdio: ['ignore', 'inherit', 'inherit'],
        });
        await waitForServer(backend.port, backend.child);
      };
      backend.reset = async () => {
        await stop(backend.child);
        await rm(join(directory, 'src'), { recursive: true, force: true });
        await cp(join(kitchenSink, 'src'), join(directory, 'src'), { recursive: true });
        await rm(join(output, 'public'), { recursive: true, force: true });
        await mkdir(join(output, 'public'), { recursive: true });
        await start();
      };
      backends.push(backend);
      await backend.reset();
    }
    return {
      backends,
      close: async () => {
        await Promise.all(backends.map(backend => stop(backend.child)));
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (templateProcess) {
      try {
        process.kill(-templateProcess.pid, 'SIGTERM');
      } catch {}
    }
    await Promise.all(backends.map(backend => stop(backend.child)));
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.E2E_PORT || 4111);
  const size = Number(process.env.E2E_APP_POOL_SIZE || 4);
  if (!Number.isInteger(size) || size < 1 || size > 16) throw new Error('E2E_APP_POOL_SIZE must be 1–16');
  const kitchenSink = join(dirname(fileURLToPath(import.meta.url)), 'kitchen-sink');
  const pool = await startIsolatedApps({ size, port, kitchenSink });
  const gateway = createGateway(pool.backends);
  gateway.listen(port, '0.0.0.0', () => console.log(`Isolated kitchen-sink ready: ${size} instances on :${port}`));
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    gateway.closeAllConnections();
    gateway.close();
    await pool.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
