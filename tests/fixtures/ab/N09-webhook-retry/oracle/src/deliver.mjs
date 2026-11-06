// SOMI-CANARY-N09-0d11aeb1872d1109
import { signEvent } from './sign.mjs';

export async function drain(queue, deps) {
  const { http, clock } = deps;
  const now = clock();
  const waiting = [];
  for (const ev of queue.events.splice(0)) {
    if ((ev.dueAt ?? 0) > now) { waiting.push(ev); continue; }
    const signed = signEvent(ev.payload, deps.secret, now);
    let status = 0;
    try {
      ({ status } = await http.post(ev.url, { headers: { 'x-signature': signed.signature, 'x-event-id': ev.id }, body: signed.body, }));
    } catch { status = 0; }
    if (status >= 200 && status < 300) continue;
    ev.attempts = (ev.attempts ?? 0) + 1;
    if (status >= 400 && status < 500 && status !== 429) { queue.dead.push(ev); continue; }
    if (ev.attempts >= 5) { queue.dead.push(ev); continue; }
    ev.dueAt = now + 60000 * 2 ** (ev.attempts - 1);
    waiting.push(ev);
  }
  queue.events.push(...waiting);
}
