import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPage } from '../../src/pagination/paginate.mjs';
import { encodeCursor } from '../../src/pagination/cursor.mjs';

test('returns the first page and a cursor for more', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const page = listPage(items, null, 2);
  assert.deepEqual(page.items, ['a', 'b']);
  assert.equal(page.remaining, 3);
  assert.ok(page.nextCursor);
});

test('pages through to the end using the returned cursor', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const page1 = listPage(items, null, 2);
  const page2 = listPage(items, page1.nextCursor, 2);
  assert.deepEqual(page2.items, ['c', 'd']);
  assert.equal(page2.remaining, 1);

  const page3 = listPage(items, page2.nextCursor, 2);
  assert.deepEqual(page3.items, ['e']);
  assert.equal(page3.remaining, 0);
  assert.equal(page3.nextCursor, null);
});

test('an exact-multiple list ends with no next cursor', () => {
  const items = ['a', 'b', 'c', 'd'];
  const page1 = listPage(items, null, 2);
  const page2 = listPage(items, page1.nextCursor, 2);
  assert.deepEqual(page2.items, ['c', 'd']);
  assert.equal(page2.nextCursor, null);
});

test('rejects a cursor issued for a much longer list', () => {
  const items = ['a', 'b'];
  const cursor = encodeCursor(100);
  assert.throws(() => listPage(items, cursor, 2), /cursor out of range/);
});

test('rejects a malformed cursor', () => {
  const items = ['a', 'b'];
  assert.throws(() => listPage(items, 'not-a-cursor', 2), /malformed cursor/);
});
