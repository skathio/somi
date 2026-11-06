// SOMI-CANARY-N09-0d11aeb1872d1109
import { signEvent } from './sign.mjs';

const BACKOFF_MINUTES = [1, 2, 4, 8];
const isFinalRefusal = (s) => s >= 400 && s < 500 && s !== 429;

async function attempt(ev, { http, clock, secret }) {
  const { body, signature } = signEvent(ev.payload, secret, clock());
  try {
    return (await http.post(ev.url, { headers: { 'x-signature': signature, 'x-event-id': ev.id }, body })).status;
  } catch {
    return null;
  }
}

export async function drain(queue, deps) {
  const batch = queue.events;
  queue.events = [];
  const keep = [];
  for (const ev of batch) {
    if (ev.retryAt !== undefined && ev.retryAt > deps.clock()) { keep.push(ev); continue; }
    const status = await attempt(ev, deps);
    if (status !== null && status >= 200 && status < 300) continue;
    const failures = (ev.failures ?? 0) + 1;
    if (isFinalRefusal(status) || failures === 5) queue.dead.push({ ...ev, failures });
    else keep.push({ ...ev, failures, retryAt: deps.clock() + BACKOFF_MINUTES[failures - 1] * 60000 });
  }
  queue.events.unshift(...keep);
}
