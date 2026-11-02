import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeSlots } from '../src/availability.mjs';

test('an empty room is free', () => {
  const store = { rooms: { a: { bufferMin: 0 } }, bookings: [], closures: [], nextId: 1 };
  assert.deepEqual(freeSlots(store, 'a', 0, 60), [{ start: 0, end: 60 }]);
});
