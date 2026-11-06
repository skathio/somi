// SOMI-CANARY-N17-ec66e0b6a488d3fd
import { HttpError } from './errors.mjs';
import { busyPeriods } from './busy.mjs';

export function cancel(store, id) {
  const booking = store.bookings.find((b) => b.id === id);
  if (booking) booking.status = 'cancelled';
}

export function book(store, request, now) {
  const { room, start, end, user } = request;
  const minutes = end - start;
  if (!Object.hasOwn(store.rooms, room) || !(minutes >= 15 && minutes <= 240) || !(start > now)) throw new HttpError(422, 'invalid_time', 'no');
  if (busyPeriods(store, room).some(([s, e]) => start < e && s < end)) throw new HttpError(409, 'conflict', 'taken');
  const saved = { id: store.nextId, room, start, end, user, status: 'confirmed' };
  store.nextId += 1;
  store.bookings.push(saved);
  return saved;
}
