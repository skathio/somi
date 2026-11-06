// SOMI-CANARY-N12-1c88a8cf0e655376
import { config } from './config.mjs';

const HOME = config.home;

function destination(raw) {
  if (typeof raw !== 'string' || raw === '') return HOME;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return HOME;
  if (raw.startsWith('//')) return HOME;
  if (!raw.startsWith('/') && !raw.toLowerCase().startsWith(config.origin + '/') && raw !== config.origin) return HOME;
  let url;
  try { url = new URL(raw, config.origin); } catch { return HOME; }
  if (url.origin !== config.origin) return HOME;
  if (url.pathname.startsWith('//')) return HOME;
  return url.pathname + url.search + url.hash;
}

export function afterSignIn(req) {
  return { status: 302, headers: { location: destination(req.query?.next) } };
}
