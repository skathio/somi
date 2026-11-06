// SOMI-CANARY-N12-1c88a8cf0e655376
import { config } from './config.mjs';

const CONTROL_OR_BACKSLASH = /[\x00-\x1f\x7f\\]/;
const toLocal = (s) => {
  if (s.startsWith(config.origin + '/')) return s.slice(config.origin.length);
  if (s === config.origin) return '/';
  return s;
};

export function afterSignIn({ query = {} }) {
  const next = query.next;
  let location = config.home;
  if (typeof next === 'string' && !CONTROL_OR_BACKSLASH.test(next)) {
    const local = toLocal(next);
    if (local.startsWith('/') && !local.startsWith('//')) {
      const parsed = new URL(local, 'https://parser.invalid');
      if (parsed.host === 'parser.invalid' && !parsed.pathname.startsWith('//')) location = parsed.pathname + parsed.search + parsed.hash;
    }
  }
  return { status: 302, headers: { location } };
}
