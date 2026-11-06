export function cancel(store, id) {
  const booking = store.bookings.find((b) => b.id === id);
  if (booking) booking.status = 'cancelled';
}
