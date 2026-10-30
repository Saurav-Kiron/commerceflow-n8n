import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateTicket, redact, rulesTriage, validateAnalysis } from '../src/triage.js';
import { createStore, createTriageService } from '../src/store.js';
import { createProvider } from '../src/provider.js';

const ticket = { ticket_id: 't-1', subject: 'Where is my order?', message: 'The delivery is late.' };

test('rejects empty, oversized, extra fields and invalid identifiers', () => {
  for (const input of [null, [], {}, { ...ticket, message: '' }, { ...ticket, message: 'a'.repeat(5001) },
    { ...ticket, email: 'private@example.com' }, { ...ticket, ticket_id: '../x' }]) {
    assert.throws(() => validateTicket(input), { code: 'INVALID_TICKET' });
  }
});

test('rules classify shipping, refunds, damage, product questions and other', () => {
  for (const [message, expected] of [['delivery late', 'shipping'], ['refund please', 'refund'],
    ['arrived broken', 'damaged_item'], ['what size?', 'product_question'], ['hello', 'other']]) {
    assert.equal(rulesTriage({ subject: '', message }).category, expected);
  }
});

test('basic redaction removes email and phone-like numbers', () => {
  assert.equal(redact('Write to alex@example.com or +91 98765 43210'), 'Write to [EMAIL] or [NUMBER]');
});

test('same ticket is cached; changed payload conflicts; raw source text is not stored', async () => {
  const store = createStore(':memory:');
  let calls = 0;
  const triage = createTriageService({ store, provider: async t => { calls++; return { analysis: rulesTriage(t), provider: 'rules' }; } });
  try {
    const result = await triage(ticket);
    assert.equal(result.result.human_review_required, true);
    assert.equal(result.result.queue, 'specialist-review');
    assert.equal((await triage(ticket)).duplicate, true);
    assert.equal(calls, 1);
    await assert.rejects(triage({ ...ticket, message: 'changed' }), { code: 'TICKET_CONFLICT' });
    assert.equal(JSON.stringify(store.get('t-1')).includes(ticket.message), false);
  } finally { store.close(); }
});

test('cached result survives closing and reopening SQLite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'commerceflow-'));
  let store = createStore(join(dir, 'test.db'));
  try {
    await createTriageService({ store, provider: createProvider() })(ticket);
    store.close();
    store = createStore(join(dir, 'test.db'));
    const result = await createTriageService({ store, provider: () => { throw new Error('must not call'); } })(ticket);
    assert.equal(result.duplicate, true);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

test('simultaneous duplicate is rejected while one request processes', async () => {
  const store = createStore(':memory:');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const triage = createTriageService({ store, provider: async t => { await gate; return { analysis: rulesTriage(t), provider: 'rules' }; } });
  try {
    const pending = triage(ticket);
    await assert.rejects(triage(ticket), { code: 'TICKET_IN_PROGRESS' });
    release(); await pending;
  } finally { store.close(); }
});

test('failed provider leaves ticket retryable', async () => {
  const store = createStore(':memory:');
  let calls = 0;
  const triage = createTriageService({ store, provider: async t => {
    if (calls++ === 0) throw new Error('temporary failure');
    return { analysis: rulesTriage(t), provider: 'rules' };
  } });
  try { await assert.rejects(triage(ticket)); assert.equal((await triage(ticket)).duplicate, false); }
  finally { store.close(); }
});

test('local safety rule overrides model normal priority; real model shipping uses standard review', async () => {
  const store = createStore(':memory:');
  const triage = createTriageService({ store, provider: async t => ({ analysis: { ...rulesTriage(t), priority: 'normal' }, provider: 'openai' }) });
  try {
    assert.equal((await triage(ticket)).result.queue, 'standard-review');
    assert.equal((await triage({ ...ticket, ticket_id: 'safety', message: 'allergic reaction' })).result.queue, 'priority-review');
  } finally { store.close(); }
});

test('model output must match allowed fields, enums and length limits', () => {
  assert.throws(() => validateAnalysis({ ...rulesTriage(ticket), category: 'invented' }));
  assert.throws(() => validateAnalysis({ ...rulesTriage(ticket), draft_reply: '' }));
  assert.throws(() => validateAnalysis({ ...rulesTriage(ticket), action: 'refund' }));
});

const complete = analysis => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(analysis) }] }] }), { status: 200 });

test('OpenAI request uses strict schema, redacted content and no server storage', async () => {
  const provider = createProvider({ mode: 'openai', apiKey: 'fake-test-key', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.input.includes('person@example.com'), false);
    assert.equal(body.input.includes('t-1'), false);
    return complete(rulesTriage(ticket));
  } });
  assert.equal((await provider({ ...ticket, message: 'person@example.com delivery' })).provider, 'openai');
});

test('retries rate limits and network failures, but not authentication failures', async () => {
  for (const kind of ['rate-limit', 'network']) {
    let count = 0;
    const provider = createProvider({ mode: 'openai', apiKey: 'fake', sleep: async () => {}, fetchImpl: async () => {
      if (++count < 3) {
        if (kind === 'network') throw new Error('network');
        return new Response('{}', { status: 429 });
      }
      return complete(rulesTriage(ticket));
    } });
    await provider(ticket); assert.equal(count, 3);
  }
  let count = 0;
  const provider = createProvider({ mode: 'openai', apiKey: 'fake', fetchImpl: async () => { count++; return new Response('{}', { status: 401 }); } });
  await assert.rejects(provider(ticket), { code: 'AI_UNAVAILABLE' }); assert.equal(count, 1);
});

test('retry exhaustion, refusals, incomplete responses and malformed output fail closed', async () => {
  for (const response of [new Response('{}', { status: 503 }),
    new Response(JSON.stringify({ status: 'incomplete' })),
    new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] })),
    complete({ category: 'invalid' }), new Response('not json')]) {
    const provider = createProvider({ mode: 'openai', apiKey: 'fake', sleep: async () => {}, fetchImpl: async () => response.clone() });
    await assert.rejects(provider(ticket));
  }
});
