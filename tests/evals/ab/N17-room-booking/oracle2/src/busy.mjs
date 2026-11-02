// SOMI-CANARY-N17-ec66e0b6a488d3fd
export function busyPeriods(store, room) {
  const buffer = store.rooms[room]?.bufferMin ?? 0;
  const out = store.closures.filter((c) => c.room === room).map(({ start, end }) => [start, end]);
  for (const b of store.bookings) if (b.room === room && b.status !== 'cancelled') out.push([b.start - buffer, b.end + buffer]);
  return out.sort((x, y) => x[0] - y[0]);
}
