// SOMI-CANARY-N17-ec66e0b6a488d3fd
import { HttpError } from './errors.mjs';

const clash = (a, b, gap) => a.start < b.end + gap && b.start < a.end + gap;

export function cancel(store, id) {
  const booking = store.bookings.find((b) => b.id === id);
  if (booking) booking.status = 'cancelled';
}

export function book(store, { room, start, end, user }, now) {
  const info = Object.hasOwn(store.rooms, room) ? store.rooms[room] : null;
  const length = end - start;
  if (!info || !Number.isInteger(start) || !Number.isInteger(end) || length < 15 || length > 240 || start <= now) throw new HttpError(422, 'invalid_time', 'those times cannot be booked');
  const wanted = { start, end };
  const closed = store.closures.filter((c) => c.room === room);
  const live = store.bookings.filter((b) => b.room === room && b.status !== 'cancelled');
  if (closed.some((c) => clash(wanted, c, 0)) || live.some((b) => clash(wanted, b, info.bufferMin))) throw new HttpError(409, 'conflict', 'the room is taken');
  const booking = { id: store.nextId++, room, start, end, user, status: 'confirmed' };
  store.bookings.push(booking);
  return booking;
}
