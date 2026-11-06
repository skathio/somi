import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { createTask, getTask } from '../src/tasks.mjs';

test('a task can be read back', () => {
  const s = createStore();
  s.users.push({ id: 'u', orgId: 'o', name: 'a' });
  s.projects.push({ id: 'p', orgId: 'o', name: 'P' });
  const t = createTask(s, { userId: 'u' }, { projectId: 'p', title: 'x' });
  assert.equal(getTask(s, { userId: 'u' }, t.id).title, 'x');
});
