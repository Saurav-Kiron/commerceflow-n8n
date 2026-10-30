import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError, route, validateAnalysis, validateTicket } from './triage.js';

export function createStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS tickets (
      ticket_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
      result TEXT NOT NULL, created_at TEXT NOT NULL
    );`);
  return {
    get: id => db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(id),
    save: (id, hash, result) => db.prepare('INSERT INTO tickets VALUES (?, ?, ?, ?)')
      .run(id, hash, JSON.stringify(result), new Date().toISOString()),
    close: () => db.close()
  };
}

export function createTriageService({ store, provider }) {
  const inFlight = new Set();
  return async input => {
    const ticket = validateTicket(input);
    const hash = createHash('sha256').update(JSON.stringify(ticket)).digest('hex');
    const previous = store.get(ticket.ticket_id);
    if (previous) {
      if (previous.fingerprint !== hash) throw new AppError(409, 'TICKET_CONFLICT', 'This ticket_id already has different content.');
      return { ticket_id: ticket.ticket_id, duplicate: true, result: JSON.parse(previous.result) };
    }
    if (inFlight.has(ticket.ticket_id)) throw new AppError(409, 'TICKET_IN_PROGRESS', 'Ticket is being processed; retry shortly.');
    inFlight.add(ticket.ticket_id);
    try {
      const { analysis, provider: name } = await provider(ticket);
      validateAnalysis(analysis);
      // High-risk keywords cannot be downgraded by an LLM classification.
      if (/fraud|chargeback|unsafe|allerg|injur|urgent/i.test(`${ticket.subject} ${ticket.message}`)) analysis.priority = 'high';
      const result = route(analysis, name);
      store.save(ticket.ticket_id, hash, result);
      return { ticket_id: ticket.ticket_id, duplicate: false, result };
    } finally { inFlight.delete(ticket.ticket_id); }
  };
}
