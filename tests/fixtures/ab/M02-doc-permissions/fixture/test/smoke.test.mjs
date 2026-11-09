import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { createDoc, readDoc } from '../src/docs.mjs';

test('an editor creates a document a viewer can read', () => {
  const store = createStore({ clock: () => '2031-09-01T00:00:00Z', users: [{ id: 'ed', orgId: 'o1', roles: ['editor'] }, { id: 'vic', orgId: 'o1', roles: ['viewer'] }] });
  const doc = createDoc(store, 'ed', { title: 'Plan', body: 'text' }).value;
  assert.equal(readDoc(store, 'vic', doc.id).value.title, 'Plan');
});
