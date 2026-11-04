export async function drain(queue, { http }) {
  const pending = queue.events.splice(0);
  for (const ev of pending) {
    await http.post(ev.url, { headers: { 'x-signature': ev.signed.signature, 'x-event-id': ev.id }, body: ev.signed.body });
  }
}
