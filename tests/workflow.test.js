import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('workflow graph connects both review branches and API failures to webhook responses', () => {
  const workflow = JSON.parse(readFileSync(new URL('../workflows/commerceflow.json', import.meta.url)));
  const names = new Set(workflow.nodes.map(node => node.name));
  assert.equal(names.size, workflow.nodes.length);
  assert.equal(workflow.active, false);
  const visit = name => {
    const outputs = workflow.connections[name]?.main;
    if (!outputs) {
      assert.equal(workflow.nodes.find(node => node.name === name).type, 'n8n-nodes-base.respondToWebhook');
      return;
    }
    for (const output of outputs) for (const edge of output) { assert.ok(names.has(edge.node)); visit(edge.node); }
  };
  visit('Ticket Webhook');
  assert.equal(workflow.nodes[0].parameters.authentication, 'headerAuth');
  assert.equal(workflow.nodes[1].parameters.genericAuthType, 'httpHeaderAuth');
  assert.equal(JSON.stringify(workflow).includes('Bearer '), false);
});
