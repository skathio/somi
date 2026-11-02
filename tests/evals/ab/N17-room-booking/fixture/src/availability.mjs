// The free stretches of a room between from and to, earliest first.
export function freeSlots(store, room, from, to) {
  const busy = store.bookings.filter((b) => b.room === room).sort((a, b) => a.start - b.start);
  const slots = [];
  let at = from;
  for (const b of busy) {
    if (b.start > at) slots.push({ start: at, end: Math.min(b.start, to) });
    at = Math.max(at, b.end);
  }
  if (at < to) slots.push({ start: at, end: to });
  return slots.filter((s) => s.start < s.end);
}
