// SOMI-CANARY-N35-e5bc70e2ce383791
const CORE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

function ver(s) {
  const m = CORE.exec(String(s).trim());
  if (!m || [m[1], m[2], m[3]].some((n) => n.length > 1 && n[0] === '0')) return null;
  const ids = m[4] ? m[4].split('.') : [];
  if (ids.some((p) => p === '' || (/^\d+$/.test(p) && p.length > 1 && p[0] === '0'))) return null;
  return { n: [+m[1], +m[2], +m[3]], ids };
}

function cmpIds(a, b) {
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  if (b.length === 0) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const an = /^\d+$/.test(a[i]);
    const bn = /^\d+$/.test(b[i]);
    if (an !== bn) return an ? -1 : 1;
    if (an) { if (+a[i] !== +b[i]) return +a[i] - +b[i]; continue; }
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i] - b.n[i];
  return cmpIds(a.ids, b.ids);
}

// A range piece becomes a low and a high bound: [version, inclusive] or null.
function loose(s) {
  const m = /^v?([0-9xX*]+)(?:\.([0-9xX*]+))?(?:\.([0-9xX*]+))?(?:-?([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(s);
  if (!m) return undefined;
  const nums = [m[1], m[2], m[3]];
  for (const n of nums) if (n !== undefined && !/^(\d+|[xX*])$/.test(n)) return undefined;
  for (const n of nums) if (n !== undefined && /^\d+$/.test(n) && n.length > 1 && n[0] === '0') return undefined;
  const fixed = [];
  for (const n of nums) { if (n === undefined || !/^\d+$/.test(n)) break; fixed.push(+n); }
  if (m[4] && fixed.length < 3) return undefined;
  return { fixed, pre: m[4] ? m[4].split('.') : [] };
}
const mk = (a, b, c, ids = []) => ({ n: [a, b, c], ids });
const floorOf = (p) => mk(p.fixed[0] ?? 0, p.fixed[1] ?? 0, p.fixed[2] ?? 0, p.pre);
function nextOf(p) {
  if (p.fixed.length === 1) return mk(p.fixed[0] + 1, 0, 0, ['0']);
  if (p.fixed.length === 2) return mk(p.fixed[0], p.fixed[1] + 1, 0, ['0']);
  return null;
}

function bounds(op, p) {
  if (p.fixed.length === 0) return op === '>' || op === '<' ? { never: true } : {};
  const low = floorOf(p);
  const up = nextOf(p);
  switch (op) {
    case '^': {
      const [a, b, c] = p.fixed;
      const top = a > 0 || p.fixed.length === 1 ? mk(a + 1, 0, 0, ['0']) : b > 0 || p.fixed.length === 2 ? mk(0, b + 1, 0, ['0']) : mk(0, 0, c + 1, ['0']);
      return { lo: [low, true], hi: [top, false] };
    }
    case '~': return { lo: [low, true], hi: [p.fixed.length === 1 ? mk(p.fixed[0] + 1, 0, 0, ['0']) : mk(p.fixed[0], p.fixed[1] + 1, 0, ['0']), false] };
    case '>': return up ? { lo: [mk(up.n[0], up.n[1], up.n[2]), true] } : { lo: [low, false] };
    case '>=': return { lo: [low, true] };
    case '<': return { hi: [up ? mk(low.n[0], low.n[1], 0, ['0']) : low, false] };
    case '<=': return up ? { hi: [up, false] } : { hi: [low, true] };
    default: return up ? { lo: [low, true], hi: [up, false] } : { lo: [low, true], hi: [low, true] };
  }
}

function clause(text) {
  let t = text.trim().replace(/(\^|~>|~|>=|<=|>|<|=)\s+/g, '$1');
  const out = [];
  const hy = /^(\S+)\s+-\s+(\S+)$/.exec(t);
  if (hy) {
    const a = loose(hy[1]);
    const b = loose(hy[2]);
    if (!a || !b) return null;
    if (a.fixed.length) out.push({ lo: [floorOf(a), true] });
    if (b.fixed.length) out.push(bounds('<=', b));
    return out;
  }
  for (const word of t.split(/\s+/).filter(Boolean)) {
    const m = /^(\^|~>|~|>=|<=|>|<|=)?(.*)$/.exec(word);
    const p = loose(m[2]);
    if (!p) return null;
    out.push(bounds(m[1] === '~>' ? '~' : (m[1] ?? '='), p));
  }
  return out;
}

export function satisfies(version, range) {
  const v = ver(version);
  if (!v || typeof range !== 'string') return false;
  let result = false;
  for (const piece of range.split('||')) {
    const c = clause(piece);
    if (!c) return false;
    const inside = c.every((b) => !b.never && (!b.lo || (b.lo[1] ? cmp(v, b.lo[0]) >= 0 : cmp(v, b.lo[0]) > 0)) && (!b.hi || (b.hi[1] ? cmp(v, b.hi[0]) <= 0 : cmp(v, b.hi[0]) < 0)));
    if (!inside) continue;
    if (v.ids.length === 0) { result = true; continue; }
    const same = (x) => x && x.ids.length > 0 && x.ids[0] !== '0' | x.ids.length > 1 && x.n.every((n, i) => n === v.n[i]);
    const named = c.some((b) => (b.lo && b.lo[0].ids.length && b.lo[0].n.every((n, i) => n === v.n[i])) || (b.hi && b.hi[1] && b.hi[0].ids.length && b.hi[0].n.every((n, i) => n === v.n[i])) || (b.hi && !b.hi[1] && b.hi[0].ids.length && b.hi[0].ids[0] !== '0' && b.hi[0].n.every((n, i) => n === v.n[i])));
    if (same && named) result = true;
  }
  return result;
}
