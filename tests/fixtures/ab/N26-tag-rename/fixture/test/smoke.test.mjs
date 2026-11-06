import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTag, tagKey } from '../src/tags.mjs';

test('a tag is added', () => {
  const store = { notes: [], tagCounts: {} };
  const note = { id: 1, owner: 'a', tags: [] };
  addTag(store, note, 'To Do');
  assert.deepEqual(note.tags, [tagKey('to do')]);
});
