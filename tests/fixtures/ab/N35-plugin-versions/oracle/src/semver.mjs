// SOMI-CANARY-N35-e5bc70e2ce383791
const NUM = '0|[1-9]\\d*';
const PRE = `(?:${NUM}|\\d*[a-zA-Z-][a-zA-Z0-9-]*)`;
const VERSION = new RegExp(`^v?(${NUM})\\.(${NUM})\\.(${NUM})(?:-(${PRE}(?:\\.${PRE})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
const X = '[xX*]';
const PART = `(?:${NUM}|${X})`;
const PARTIAL = `v?(${PART})(?:\\.(${PART})(?:\\.(${PART})(?:-?(${PRE}(?:\\.${PRE})*))?(?:\\+[0-9A-Za-z-.]+)?)?)?`;
const FULL_PARTIAL = new RegExp(`^${PARTIAL}$`);

function parse(text) {
  const m = VERSION.exec(String(text).trim());
  if (!m) return null;
  const nums = [m[1], m[2], m[3]].map(Number);
  if (nums.some((n) => n > Number.MAX_SAFE_INTEGER)) return null;
  return { major: nums[0], minor: nums[1], patch: nums[2], pre: m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [], text: `${nums.join('.')}${m[4] ? `-${m[4]}` : ''}` };
}

function comparePre(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  for (let i = 0; ; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined && y === undefined) return 0;
    if (y === undefined) return 1;
    if (x === undefined) return -1;
    const na = typeof x === 'number';
    const nb = typeof y === 'number';
    if (na && nb) return x - y;
    if (na) { if (!nb) return -1; }
    if (nb) return 1;
    if (x !== y) return x < y ? -1 : 1;
  }
}

function compare(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || comparePre(a.pre, b.pre);
}

const isX = (p) => p === undefined || /^[xX*]$/.test(p);

function partial(text) {
  const m = FULL_PARTIAL.exec(text);
  if (!m) return null;
  return { major: m[1], minor: m[2], patch: m[3], pre: m[4] };
}

function caret(p) {
  if (isX(p.major)) return [''];
  const major = Number(p.major);
  if (isX(p.minor)) return [`>=${major}.0.0`, `<${major + 1}.0.0-0`];
  const minor = Number(p.minor);
  if (isX(p.patch)) return major === 0 ? [`>=0.${minor}.0`, `<0.${minor + 1}.0-0`] : [`>=${major}.${minor}.0`, `<${major + 1}.0.0-0`];
  const a = { major, minor, patch: Number(p.patch), text: `${major}.${minor}.${p.patch}${p.pre ? `-${p.pre}` : ''}` };
  if (a.major > 0) return [`>=${a.text}`, `<${a.major + 1}.0.0-0`];
  if (a.minor > 0) return [`>=${a.text}`, `<0.${a.minor + 1}.0-0`];
  return [`>=${a.text}`, `<0.0.${a.patch + 1}-0`];
}

function tilde(p) {
  if (isX(p.major)) return [''];
  const major = Number(p.major);
  if (isX(p.minor)) return [`>=${major}.0.0`, `<${major + 1}.0.0-0`];
  const minor = Number(p.minor);
  if (isX(p.patch)) return [`>=${major}.${minor}.0`, `<${major}.${minor + 1}.0-0`];
  return [`>=${major}.${minor}.${p.patch}${p.pre ? `-${p.pre}` : ''}`, `<${major}.${minor + 1}.0-0`];
}

function xrange(op, p) {
  if (isX(p.major)) return op === '<' || op === '>' ? ['<0.0.0-0'] : [''];
  const major = Number(p.major);
  const minor = isX(p.minor) ? 0 : Number(p.minor);
  const patch = isX(p.patch) ? 0 : Number(p.patch);
  const partialMinor = isX(p.minor);
  const partialPatch = isX(p.patch) || partialMinor;
  const pre = p.pre ? `-${p.pre}` : '';
  if (!partialPatch) return [`${op === '=' ? '' : op}${major}.${minor}.${patch}${pre}`];
  const up = partialMinor ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
  if (op === '>') return [`>=${up}`];
  if (op === '<=') return [`<${up}-0`];
  if (op === '<') return [`<${major}.${minor}.0-0`];
  if (op === '>=') return [`>=${major}.${minor}.0`];
  return [`>=${major}.${minor}.0`, `<${up}-0`];
}

function hyphen(from, to) {
  const a = partial(from);
  const b = partial(to);
  if (!a || !b) return null;
  const low = isX(a.major) ? [''] : xrange('>=', a);
  let high;
  if (isX(b.major)) high = [''];
  else if (isX(b.minor)) high = [`<${Number(b.major) + 1}.0.0-0`];
  else if (isX(b.patch)) high = [`<${b.major}.${Number(b.minor) + 1}.0-0`];
  else high = [`<=${to.replace(/^v/, '')}`];
  return [...low, ...high];
}

function comparators(part) {
  const text = part.trim().replace(/(>=|<=|>|<|=|~>|~|\^)\s+/g, '$1');
  const h = /^(\S+)\s+-\s+(\S+)$/.exec(text);
  const words = h ? hyphen(h[1], h[2]) : text.split(/\s+/).filter(Boolean).flatMap((word) => {
    const m = /^(>=|<=|>|<|=|~>|~|\^)?(.*)$/.exec(word);
    const p = partial(m[2]);
    if (!p) return [null];
    if (m[1] === '^') return caret(p);
    if (m[1] === '~' || m[1] === '~>') return tilde(p);
    return xrange(m[1] ?? '=', p);
  });
  if (!words || words.includes(null)) return null;
  const out = [];
  for (const w of words.length ? words : ['']) {
    if (w === '') continue;
    const m = /^(>=|<=|>|<)?(.+)$/.exec(w);
    const v = parse(m[2]);
    if (!v) return null;
    out.push({ op: m[1] ?? '=', v });
  }
  return out;
}

function test(set, v) {
  for (const { op, v: c } of set) {
    const d = compare(v, c);
    if (!(op === '=' ? d === 0 : op === '>=' ? d >= 0 : op === '<=' ? d <= 0 : op === '>' ? d > 0 : d < 0)) return false;
  }
  if (v.pre.length && !set.some((c) => c.v.pre.length && c.v.major === v.major && c.v.minor === v.minor && c.v.patch === v.patch)) return false;
  return true;
}

export function satisfies(version, range) {
  const v = parse(version);
  if (!v || typeof range !== 'string') return false;
  let any = false;
  for (const part of range.split('||')) {
    const set = comparators(part);
    if (!set) return false;
    if (test(set, v)) any = true;
  }
  return any;
}
