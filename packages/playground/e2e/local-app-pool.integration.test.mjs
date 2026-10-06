import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createLeaseServer, startLocalApps } from './local-app-pool.mjs';

test('local native entrypoints isolate database/source writes and expose CLI package metadata', async t => {
  const port = 49151;
  const pool = await startLocalApps({
    size: 2,
    port,
    kitchenSink: join(dirname(fileURLToPath(import.meta.url)), 'kitchen-sink'),
  });
  const server = createLeaseServer(pool.apps);
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await pool.close();
  });
  const url = `http://127.0.0.1:${port}`;
  const lease = async id => {
    const response = await fetch(`${url}/__e2e/lease`, { method: 'POST', headers: { 'x-mastra-e2e-session': id } });
    assert.equal(response.status, 201);
    return (await response.json()).baseURL;
  };
  const release = id => fetch(`${url}/__e2e/lease`, { method: 'DELETE', headers: { 'x-mastra-e2e-session': id } });
  const [a, b] = await Promise.all([lease('a'), lease('b')]);
  assert.notEqual(a, b);
  const metadata = await fetch(`${a}/api/system/packages`).then(r => r.json());
  assert.ok(metadata.packages.some(p => p.name === '@mastra/memory'));
  assert.equal(metadata.isDev, true);
  const seeds = await Promise.all(
    [
      [a, 2],
      [b, 3],
    ].map(([origin, count]) =>
      fetch(`${origin}/e2e/seed-thread`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ threadId: 'identical-thread', count }),
      }),
    ),
  );
  assert.ok(seeds.every(r => r.status === 201));
  const messages = origin =>
    fetch(`${origin}/api/memory/threads/identical-thread/messages?agentId=weather-agent`).then(r => r.json());
  assert.equal((await messages(a)).messages.length, 2);
  assert.equal((await messages(b)).messages.length, 3);
  const app = pool.apps.find(app => `http://localhost:${app.port}` === a);
  const directory = dirname(dirname(dirname(app.child.spawnargs[2])));
  const source = join(directory, 'src/mastra/reset-proof.json');
  await writeFile(source, '{"changed":true}');
  assert.equal((await release('a')).status, 200);
  await assert.rejects(access(source));
  assert.equal((await messages(b)).messages.length, 3);
  const c = await lease('c');
  assert.equal(c, a);
  assert.equal((await fetch(`${c}/api/memory/threads/identical-thread/messages?agentId=weather-agent`)).status, 404);
  assert.equal((await release('c')).status, 200);
  assert.equal((await release('b')).status, 200);
});
