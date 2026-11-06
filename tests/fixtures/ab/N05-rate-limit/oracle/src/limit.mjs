// SOMI-CANARY-N05-6f895e29eb0863f5
const WINDOW_MS = 60000;
const LIMIT = 100;

export function createLimiter({ clock, keys }) {
  const hits = new Map();
  const bucket = ({ headers, remote }) => {
    const key = headers['x-api-key'];
    if (key && keys.has(key)) return `key:${key}`;
    const forwarded = headers['x-forwarded-for'];
    if (!forwarded) return `ip:${remote}`;
    const ip = forwarded.split(',').at(-1).trim();
    return `ip:${ip}`;
  };
  return {
    allow(req) {
      const id = bucket(req);
      const now = clock();
      const list = (hits.get(id) ?? []).filter((t) => now - t < WINDOW_MS);
      if (list.length >= LIMIT) {
        hits.set(id, list);
        this.wait = Math.max(1, Math.ceil((list[0] + WINDOW_MS - now) / 1000));
        return false;
      }
      list.push(now);
      hits.set(id, list);
      return true;
    },
    wait: 0,
  };
}
