import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transition } from '../src/tickets.mjs';

test('assign', () => {
  const t = { id: 1, status: 'open', assignee: null, updatedAt: 0 };
  assert.equal(transition(t, 'assign', { id: 'a' }, 5)[0].type, 'ticket.assigned');
  assert.equal(t.status, 'assigned');
});
