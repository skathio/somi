import { signEvent } from './sign.mjs';

export function enqueue(queue, event, { clock, secret }) {
  queue.events.push({ ...event, signed: signEvent(event.payload, secret, clock()) });
}
