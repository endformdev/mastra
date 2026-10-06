import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createLeaseServer } from './local-app-pool.mjs';

test('leases distinct ports and queues reuse until a failed attempt has been reset', async t => {
  let finishReset;
  const reset = new Promise(resolve => {
    finishReset = resolve;
  });
  const server = createLeaseServer([
    { port: 5111, reset: async () => reset },
    { port: 5112, reset: async () => {} },
  ]);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (id, method) => fetch(`${url}/__e2e/lease`, { method, headers: { 'x-mastra-e2e-session': id } });
  assert.equal((await fetch(`${url}/api/agents`)).status, 404);
  assert.equal((await request('a', 'POST')).status, 201);
  const b = await request('b', 'POST');
  assert.equal((await b.json()).baseURL, 'http://localhost:5112');
  assert.equal((await request('a', 'POST')).status, 409);
  let allocated = false;
  const waiting = request('c', 'POST').then(response => {
    allocated = true;
    return response;
  });
  const released = request('a', 'DELETE');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(allocated, false);
  finishReset();
  assert.equal((await released).status, 200);
  assert.equal((await (await waiting).json()).baseURL, 'http://localhost:5111');
  assert.equal((await request('missing', 'DELETE')).status, 404);
  assert.equal(server.isolationMetrics.maxActive, 2);
});
