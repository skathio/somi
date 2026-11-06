// SOMI-CANARY-N17-ec66e0b6a488d3fd
export function freeSlots(store, room, from, to) {
  const gap = store.rooms[room]?.bufferMin ?? 0;
  const held = store.bookings.filter((b) => b.room === room && b.status !== 'cancelled').map((b) => ({ start: b.start - gap, end: b.end + gap }));
  const shut = store.closures.filter((c) => c.room === room).map((c) => ({ start: c.start, end: c.end }));
  const busy = [...held, ...shut].sort((a, b) => a.start - b.start);
  const slots = [];
  let at = from;
  for (const b of busy) {
    if (b.start > at) slots.push({ start: at, end: Math.min(b.start, to) });
    at = Math.max(at, b.end);
  }
  if (at < to) slots.push({ start: at, end: to });
  return slots.filter((s) => s.start < s.end);
}
