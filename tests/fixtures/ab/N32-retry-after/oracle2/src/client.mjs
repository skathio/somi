// SOMI-CANARY-N32-253539dea3f36411
import { delayFrom } from './delay.mjs';

const canRepeat = (r) => ['GET', 'HEAD', 'PUT', 'DELETE'].includes(r.method) || Boolean(r.headers && r.headers['idempotency-key']);

export async function send(request, deps) {
  let total = 0;
  let last;
  for (let n = 0; n < 5; n++) {
    last = await deps.http(request);
    if (![429, 503].includes(last.status) || !canRepeat(request) || n === 4) return last;
    const ms = delayFrom(last.headers && last.headers['retry-after'], deps.clock(), 1000 * 2 ** n);
    if (total + ms > 60000) return last;
    total += ms;
    await deps.sleep(ms);
  }
  return last;
}
