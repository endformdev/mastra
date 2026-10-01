import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createGateway, SESSION_HEADER } from './isolation-server.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

test('concurrent leases isolate writes and resets, and queued tests reuse a clean instance', async t => {
  const backends = [];
  for (let index = 0; index < 2; index++) {
    let value = '';
    const app = createServer((req, res) => {
      if (req.method === 'POST') value = req.headers['x-value'];
      res.end(JSON.stringify({ instance: index, value }));
    });
    backends.push({
      port: await listen(app),
      reset: async () => {
        value = '';
      },
    });
    t.after(() => {
      app.closeAllConnections();
      app.close();
    });
  }
  const gateway = createGateway(backends);
  const url = `http://127.0.0.1:${await listen(gateway)}`;
  t.after(() => {
    gateway.closeAllConnections();
    gateway.close();
  });
  const headers = session => ({ [SESSION_HEADER]: session });
  const lease = session => fetch(`${url}/__e2e/lease`, { method: 'POST', headers: headers(session) });
  const release = session => fetch(`${url}/__e2e/lease`, { method: 'DELETE', headers: headers(session) });
  const read = session => fetch(url, { headers: headers(session) }).then(response => response.json());
  assert.equal((await fetch(url)).status, 409);
  assert.equal((await lease('a')).status, 201);
  assert.equal((await lease('b')).status, 201);
  await Promise.all(
    ['a', 'b'].map(session => fetch(url, { method: 'POST', headers: { ...headers(session), 'x-value': session } })),
  );
  const [a, b] = await Promise.all([read('a'), read('b')]);
  assert.notEqual(a.instance, b.instance);
  assert.equal(a.value, 'a');
  assert.equal(b.value, 'b');
  assert.equal((await lease('a')).status, 409);
  const queued = lease('c');
  assert.equal((await release('a')).status, 200);
  assert.equal((await queued).status, 201);
  assert.deepEqual(await read('c'), { instance: a.instance, value: '' });
  assert.deepEqual(await read('b'), b);
  assert.equal((await fetch(url, { headers: headers('a') })).status, 409);
  assert.equal((await release('c')).status, 200);
  assert.equal((await release('b')).status, 200);
});
