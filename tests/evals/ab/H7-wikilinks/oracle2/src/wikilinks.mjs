// SOMI-CANARY-H7-3b8f60d2a1c479e5
import { escapeHtml } from './escape.mjs';

const ENTITY_ORDER = [['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"], ['&amp;', '&']];
const UNRESERVED = /[A-Za-z0-9\-._~]/;
const encoder = new TextEncoder();

function typed(escaped) {
  let s = escaped;
  for (const [entity, ch] of ENTITY_ORDER) s = s.split(entity).join(ch);
  return s;
}

function addressPart(name) {
  let out = '';
  for (const byte of encoder.encode(name)) {
    const ch = String.fromCharCode(byte);
    out += byte < 128 && UNRESERVED.test(ch) ? ch : '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

// Finds the end of a `[[name]]` or `[[name|shown]]` that starts at `open`; returns null when it is not a link.
function scan(s, open) {
  let j = open + 2;
  while (j < s.length && s[j] !== '[' && s[j] !== ']' && s[j] !== '|') j++;
  const name = s.slice(open + 2, j);
  if (s.startsWith(']]', j)) return { name, shown: undefined, end: j + 2 };
  if (s[j] !== '|') return null;
  let k = j + 1;
  while (k < s.length && s[k] !== '[' && s[k] !== ']') k++;
  return s.startsWith(']]', k) ? { name, shown: s.slice(j + 1, k), end: k + 2 } : null;
}

/** Replaces every well-formed wiki link in escaped text with a parked anchor; `park` stores HTML, `format` renders shown text. */
export function parkWikiLinks(s, park, format) {
  let out = '';
  let i = 0;
  for (let open = s.indexOf('[[', i); open !== -1; open = s.indexOf('[[', i)) {
    const found = scan(s, open);
    const name = found ? typed(found.name).split(/\s+/).filter(Boolean).join(' ') : '';
    if (!found || name === '' || name.includes('\u0000')) {
      out += s.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    const shown = (found.shown ?? '').split(/\s+/).filter(Boolean).join(' ');
    out += s.slice(i, open) + park(`<a href="/wiki/${addressPart(name)}">${shown === '' ? escapeHtml(name) : format(shown)}</a>`);
    i = found.end;
  }
  return out + s.slice(i);
}
