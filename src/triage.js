export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const categories = ['shipping', 'refund', 'damaged_item', 'product_question', 'other'];
export const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    category: { type: 'string', enum: categories },
    priority: { type: 'string', enum: ['normal', 'high'] },
    summary: { type: 'string' },
    draft_reply: { type: 'string' }
  },
  required: ['category', 'priority', 'summary', 'draft_reply']
};

export function validateTicket(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'INVALID_TICKET', 'Expected a JSON object.');
  }
  const allowed = ['ticket_id', 'subject', 'message'];
  if (Object.keys(input).some(key => !allowed.includes(key))) {
    throw new AppError(400, 'INVALID_TICKET', 'Only ticket_id, subject and message are accepted.');
  }
  const ticket = {};
  for (const [key, max] of [['ticket_id', 80], ['subject', 200], ['message', 5000]]) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > max) {
      throw new AppError(400, 'INVALID_TICKET', `${key} must be a nonempty string of at most ${max} characters.`);
    }
    ticket[key] = input[key].trim();
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(ticket.ticket_id)) {
    throw new AppError(400, 'INVALID_TICKET', 'ticket_id accepts letters, numbers, underscores and hyphens.');
  }
  return ticket;
}

// Best effort redaction, not a complete PII detection system. Do not submit real customer data.
export function redact(text) {
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/\+?\d[\d ()-]{7,}\d/g, '[NUMBER]');
}

export function rulesTriage(ticket) {
  const text = `${ticket.subject} ${ticket.message}`.toLowerCase();
  const category = /broken|damaged|leak|cracked/.test(text) ? 'damaged_item'
    : /refund|return|cancel/.test(text) ? 'refund'
    : /shipping|delivery|tracking|where.*order|late/.test(text) ? 'shipping'
    : /size|ingredient|material|product|stock/.test(text) ? 'product_question' : 'other';
  const priority = /fraud|chargeback|unsafe|allerg|injur|urgent/.test(text) ? 'high' : 'normal';
  return {
    category, priority, summary: `Review requested: ${category.replaceAll('_', ' ')}.`,
    draft_reply: 'Thank you for contacting us. Our support team will review your request and confirm the next steps. Please share your order reference through our secure support channel if relevant.'
  };
}

export function validateAnalysis(value) {
  if (!value || !categories.includes(value.category) || !['normal', 'high'].includes(value.priority)
    || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 1000
    || typeof value.draft_reply !== 'string' || !value.draft_reply.trim() || value.draft_reply.length > 3000
    || Object.keys(value).some(key => !schema.required.includes(key))) {
    throw new AppError(502, 'INVALID_AI_OUTPUT', 'The AI response failed validation.');
  }
  return value;
}

export function route(analysis, provider) {
  // The model can raise priority, but deterministic policy can only increase review requirements.
  const queue = analysis.priority === 'high' ? 'priority-review'
    : provider === 'rules' || ['refund', 'damaged_item', 'other'].includes(analysis.category)
      ? 'specialist-review' : 'standard-review';
  return { ...analysis, queue, human_review_required: true, status: 'awaiting_review', provider };
}
