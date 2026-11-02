// SOMI-CANARY-N32-253539dea3f36411
const SAFE = new Set(['GET', 'HEAD', 'PUT', 'DELETE']);
const MAX_TRIES = 5;
const TOTAL_WAIT_MS = 60000;

function retryAfterMs(value, now) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const when = Date.parse(value);
  return Number.isNaN(when) ? null : Math.max(0, when - now);
}

export async function send(request, { http, clock, sleep }) {
  let waited = 0;
  let backoff = 1000;
  for (let attempt = 1; ; attempt++) {
    const response = await http(request);
    if (response.status !== 429 && response.status !== 503) return response;
    if (!SAFE.has(request.method) && !request.headers?.['idempotency-key']) return response;
    if (attempt >= MAX_TRIES) return response;
    const wait = retryAfterMs(response.headers?.['retry-after'], clock()) ?? backoff;
    if (waited + wait > TOTAL_WAIT_MS) return response;
    await sleep(wait);
    waited += wait;
    backoff *= 2;
  }
}
