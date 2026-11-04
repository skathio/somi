// SOMI-CANARY-N17-ec66e0b6a488d3fd
import { busyPeriods } from './busy.mjs';

export function freeSlots(store, room, from, to) {
  const slots = [];
  let cursor = from;
  for (const [s, e] of busyPeriods(store, room)) {
    const stop = Math.min(s, to);
    if (stop > cursor) slots.push({ start: cursor, end: stop });
    if (e > cursor) cursor = e;
  }
  if (cursor < to) slots.push({ start: cursor, end: to });
  return slots;
}
