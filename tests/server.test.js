import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { buildServer } from '../src/server.js';
import { createStore, createTriageService } from '../src/store.js';
import { createProvider } from '../src/provider.js';

test('HTTP API authenticates, validates, processes, deduplicates and returns safe errors', async () => {
  const apiKey = 'test-secret-abcdefghijklmnopqrstuvwxyz';
  const store = createStore(':memory:');
  const server = buildServer({ apiKey, triage: createTriageService({ store, provider: createProvider() }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${url}/triage`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, ...headers }, body });
  const body = JSON.stringify({ ticket_id: 'http-1', subject: 'Urgent', message: 'Broken product' });
  try {
    const root = await fetch(url);
    assert.equal(root.status, 200);
    assert.equal((await root.json()).name, 'CommerceFlow');
    assert.equal((await fetch(`${url}/health`)).status, 200);
    assert.equal((await fetch(`${url}/missing`)).status, 404);
    assert.equal((await post(body, { 'x-api-key': 'wrong' })).status, 401);
    assert.equal((await post(body, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post('{')).status, 400);
    assert.equal((await post('{}')).status, 400);
    assert.equal((await post(JSON.stringify({ message: 'a'.repeat(17000) }))).status, 413);
    const response = await post(body); assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.result.queue, 'priority-review');
    assert.equal(data.result.human_review_required, true);
    assert.equal((await (await post(body)).json()).duplicate, true);
    assert.equal((await post(body.replace('Broken', 'Damaged'))).status, 409);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
