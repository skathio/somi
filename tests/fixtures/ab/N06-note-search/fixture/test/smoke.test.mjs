import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listNotes } from '../src/notes.mjs';

test('a list', () => {
  const store = { notes: [{ id: 1, owner: 'a', title: 't', body: 'b', tags: [], createdAt: 1 }] };
  assert.equal(listNotes(store, 'a').total, 1);
});
