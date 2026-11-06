// Query-string parsing for the order endpoints. Every problem is a 400 with the code "invalid_query".
import { HttpError } from './http.mjs';

export const STATUSES = ['pending', 'paid', 'shipped', 'refunded', 'cancelled'];
const bad = (message) => new HttpError(400, 'invalid_query', message);

export function parseLimit(raw) {
  if (raw === null) return 20;
  if (!/^[0-9]+$/.test(raw)) throw bad('limit must be a whole number');
  const n = Number(raw);
  if (n < 1 || n > 100) throw bad('limit must be from 1 to 100');
  return n;
}

// The status filter is case-insensitive; orders store the lower-case value.
export function parseStatus(raw) {
  if (raw === null) return null;
  const status = raw.toLowerCase();
  if (!STATUSES.includes(status)) throw bad(`status must be one of ${STATUSES.join(', ')}`);
  return status;
}

// A date is YYYY-MM-DD (midnight UTC) or a full UTC timestamp YYYY-MM-DDTHH:MM:SSZ; the result is the ISO timestamp.
export function parseDate(raw, name) {
  if (raw === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})Z)?$/.exec(raw);
  const iso = m && `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}Z`;
  if (!iso || Number.isNaN(Date.parse(iso)) || `${new Date(iso).toISOString().slice(0, 19)}Z` !== iso) {
    throw bad(`${name} must be an ISO-8601 UTC date or timestamp`);
  }
  return iso;
}

export function parseFilters(params) {
  return { status: parseStatus(params.get('status')), from: parseDate(params.get('from'), 'from'), to: parseDate(params.get('to'), 'to') };
}

export function parsePaging(params) {
  return { limit: parseLimit(params.get('limit')), after: params.get('after') };
}
