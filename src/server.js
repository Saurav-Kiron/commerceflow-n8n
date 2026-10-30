import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createStore, createTriageService } from './store.js';
import { createProvider } from './provider.js';
import { AppError } from './triage.js';

function sameSecret(actual, expected) {
  const a = Buffer.from(actual ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildServer({ apiKey, triage }) {
  if (!apiKey || apiKey.length < 24 || apiKey.startsWith('replace-')) throw new Error('Set a random TRIAGE_API_KEY of at least 24 characters.');
  return createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/health') return reply(200, { status: 'ok' });
    if (req.method === 'GET' && req.url === '/') return reply(200, {
      name: 'CommerceFlow', version: '1.0.0',
      description: 'eCommerce support triage API for an n8n automation workflow',
      endpoints: { health: 'GET /health', triage: 'POST /triage (x-api-key required)' },
      input: { ticket_id: 'unique-ticket-id', subject: 'Support subject', message: 'Support message' },
      human_review_required: true,
      source: 'https://github.com/Saurav-Kiron/commerceflow-n8n'
    });
    if (req.method !== 'POST' || req.url !== '/triage') return reply(404, { error: { code: 'NOT_FOUND' } });
    if (!sameSecret(req.headers['x-api-key'], apiKey)) return reply(401, { error: { code: 'UNAUTHORIZED' } });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
      return reply(415, { error: { code: 'JSON_REQUIRED' } });
    }
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) throw new AppError(413, 'BODY_TOO_LARGE', 'Body exceeds 16 KiB.');
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new AppError(400, 'INVALID_JSON', 'Malformed JSON.'); }
      reply(200, await triage(input));
    } catch (error) {
      reply(error.status ?? 500, { error: { code: error.code && error.status ? error.code : 'INTERNAL_ERROR',
        message: error.status ? error.message : 'Processing failed; retry later.' } });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = createStore(process.env.DB_PATH ?? './data/tickets.db');
  const provider = createProvider({ mode: process.env.AI_PROVIDER ?? 'rules',
    apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini' });
  const server = buildServer({ apiKey: process.env.TRIAGE_API_KEY, triage: createTriageService({ store, provider }) });
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`CommerceFlow listening on port ${port}; provider=${process.env.AI_PROVIDER ?? 'rules'}`));
  const shutdown = () => server.close(() => { store.close(); process.exit(0); });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
