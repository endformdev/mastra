import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createGateway, startIsolatedApps, SESSION_HEADER } from './isolation-server.mjs';

test('real kitchen-sink instances isolate identical thread IDs and restore source files between leases', async t => {
  const port = 49151;
  const pool = await startIsolatedApps({
    size: 2,
    port,
    kitchenSink: join(dirname(fileURLToPath(import.meta.url)), 'kitchen-sink'),
  });
  const gateway = createGateway(pool.backends);
  gateway.listen(port, '127.0.0.1');
  await once(gateway, 'listening');
  t.after(async () => {
    gateway.closeAllConnections();
    gateway.close();
    await pool.close();
  });
  const url = `http://127.0.0.1:${port}`;
  const headers = session => ({ [SESSION_HEADER]: session, 'content-type': 'application/json' });
  const lease = session => fetch(`${url}/__e2e/lease`, { method: 'POST', headers: headers(session) });
  const release = session => fetch(`${url}/__e2e/lease`, { method: 'DELETE', headers: headers(session) });
  const messages = session =>
    fetch(`${url}/api/memory/threads/identical-thread/messages?agentId=weather-agent`, {
      headers: headers(session),
    }).then(response => response.json());
  assert.equal((await lease('a')).status, 201);
  assert.equal((await lease('b')).status, 201);
  const seeds = await Promise.all(
    [
      ['a', 2],
      ['b', 3],
    ].map(([session, count]) =>
      fetch(`${url}/e2e/seed-thread`, {
        method: 'POST',
        headers: headers(session),
        body: JSON.stringify({ threadId: 'identical-thread', count }),
      }),
    ),
  );
  assert.ok(seeds.every(response => response.status === 201));
  assert.equal((await messages('a')).messages.length, 2);
  assert.equal((await messages('b')).messages.length, 3);
  const entry = pool.backends[0].child.spawnargs[2];
  const directory = dirname(dirname(dirname(entry)));
  const sourceFile = join(directory, 'src/mastra/e2e-reset-proof.json');
  await writeFile(sourceFile, JSON.stringify({ changed: true }));
  assert.equal((await release('a')).status, 200);
  await assert.rejects(access(sourceFile));
  assert.equal((await messages('b')).messages.length, 3);
  assert.equal((await lease('c')).status, 201);
  const cleared = await fetch(`${url}/api/memory/threads/identical-thread/messages?agentId=weather-agent`, {
    headers: headers('c'),
  });
  assert.equal(cleared.status, 404);
  assert.equal((await release('c')).status, 200);
  assert.equal((await release('b')).status, 200);
});
