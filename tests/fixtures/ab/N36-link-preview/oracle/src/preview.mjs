// SOMI-CANARY-N36-cfa4a53dab63424b
import { isIP } from 'node:net';
import { HttpError } from './errors.mjs';

const refuse = () => new HttpError(400, 'forbidden_url', 'not allowed');

function internal4(text) {
  const [a, b, c] = text.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
}

function words6(text) {
  let t = text.toLowerCase().split('%')[0];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(t);
  if (dotted) { const p = dotted[1].split('.').map(Number); t = t.replace(dotted[1], `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`); }
  const [head, tail] = t.split('::');
  const h = head ? head.split(':') : [];
  const r = tail ? tail.split(':') : [];
  const fill = t.includes('::') ? Array(8 - h.length - r.length).fill('0') : [];
  return [...h, ...fill, ...r].map((x) => parseInt(x, 16));
}

function internal6(text) {
  const w = words6(text);
  const v4 = `${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`;
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return internal4(v4);
  if (w.slice(0, 7).every((x) => x === 0) && w[7] <= 1) return true;
  if (w.slice(0, 6).every((x) => x === 0)) return true;
  if (w[0] === 0x64 && w[1] === 0xff9b) return internal4(v4);
  if (w[0] === 0x2002) return internal4(`${w[1] >> 8}.${w[1] & 255}.${w[2] >> 8}.${w[2] & 255}`);
  if ((w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0 || (w[0] & 0xff00) === 0xff00) return true;
  if (w[0] === 0x2001 && w[1] === 0xdb8) return true;
  return false;
}

const isInternal = (ip) => { const kind = isIP(ip); return kind === 4 ? internal4(ip) : kind === 6 ? internal6(ip) : true; };

async function pick(url, deps) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw refuse();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await deps.resolve(host);
  if (!addresses.length || addresses.some(isInternal)) throw refuse();
  return addresses[0];
}

const titleOf = (body) => { const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(body)); return m ? m[1].trim() : null; };

export async function preview(link, deps) {
  let next;
  try { next = new URL(link); } catch { throw refuse(); }
  for (let hop = 0; hop <= 5; hop++) {
    const address = await pick(next, deps);
    const res = await deps.connect(address, next.href);
    const to = res.headers?.location;
    if (res.status >= 300 && res.status < 400 && to) {
      if (hop === 5) throw refuse();
      try { next = new URL(to, next); } catch { throw refuse(); }
      continue;
    }
    return { url: next.href, status: res.status, title: titleOf(res.body) };
  }
  throw refuse();
}
