// Schema (version 1) for the usage and speed benchmark's baseline file and its per-draw rows, plus the
// secret and path scan every committed baseline must pass. Pure: no I/O. `baselineProblems` returns the list of
// reasons a value is not a valid baseline (empty when valid); a reason never echoes a matched secret.
//
// Baseline: { schema: 1, sha (40 hex), pluginVersion, date (YYYY-MM-DD), rule {version, hash (64 hex)},
//   model {alias, tier} (opaque strings), pinAll (boolean), host {cpuModel, cores, memGb, osRelease, nodeVersion,
//   pluginVersion}, scenarios [{id, repeats, requiredTier (string or null)}],
//   L0 {bytes: {<id>: positive integer}}, L1 {events: {<name>: [positive ms numbers]}}, L2 {rows: [row]} }.
// Row: { scenario, arm (somi|bare), phase (calibration|sizing|experiment), tier (string or null), tierSource,
//   outcome (scored|paused|over-budget|invalid), costUsd, durationMs, turns, tokens {<model id>: {input, output,
//   cacheRead, cacheCreation}}, toolCalls, subagents, green, total, paused (true exactly when outcome is paused),
//   models [model ids seen] }. Every object has exactly its keys; ids match ID_PATTERN (no __proto__).

export const PHASES = ['calibration', 'sizing', 'experiment'];
export const ARMS = ['somi', 'bare'];
export const OUTCOMES = ['scored', 'paused', 'over-budget', 'invalid'];
export const TOKEN_CLASSES = ['input', 'output', 'cacheRead', 'cacheCreation'];
export const HOST_KEYS = ['cpuModel', 'cores', 'memGb', 'osRelease', 'nodeVersion', 'pluginVersion'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 5000;
const MAX_SAMPLES = 1000;

export const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const num = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const int = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const str = (s) => typeof s === 'string' && s.length >= 1 && s.length <= 120;

function shape(v, keys, at, out) {
  if (!isPlain(v)) { out.push(`${at} must be an object`); return false; }
  const own = Object.keys(v);
  for (const k of own) if (!keys.includes(k)) out.push(`${at}: unknown key ${JSON.stringify(k).slice(0, 40)}`);
  for (const k of keys) if (!Object.hasOwn(v, k)) out.push(`${at}: missing key ${k}`);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(v, k));
}

/** Reasons a value is not a valid row (empty when valid). */
export function rowProblems(r, at = 'row') {
  const out = [];
  const keys = ['scenario', 'arm', 'phase', 'tier', 'tierSource', 'outcome', 'costUsd', 'durationMs', 'turns',
    'tokens', 'toolCalls', 'subagents', 'green', 'total', 'paused', 'models'];
  if (!shape(r, keys, at, out)) return out;
  if (!ID.test(r.scenario)) out.push(`${at}.scenario invalid`);
  if (!ARMS.includes(r.arm)) out.push(`${at}.arm invalid`);
  if (!PHASES.includes(r.phase)) out.push(`${at}.phase invalid`);
  if (r.tier !== null && !str(r.tier)) out.push(`${at}.tier must be a string or null`);
  if (!str(r.tierSource)) out.push(`${at}.tierSource must be a string`);
  if (!OUTCOMES.includes(r.outcome)) out.push(`${at}.outcome invalid`);
  if (!num(r.costUsd, 0, 1e4)) out.push(`${at}.costUsd out of range`);
  if (!num(r.durationMs, 0, 1e9)) out.push(`${at}.durationMs out of range`);
  for (const k of ['turns', 'toolCalls', 'subagents']) if (!int(r[k], 0, 1e6)) out.push(`${at}.${k} out of range`);
  if (!int(r.total, 0, 1e6) || !int(r.green, 0, 1e6) || r.green > r.total) out.push(`${at}.green/total invalid`);
  else if (r.outcome === 'scored' && r.total < 1) out.push(`${at}: a scored row needs total >= 1`);
  if (typeof r.paused !== 'boolean' || r.paused !== (r.outcome === 'paused')) out.push(`${at}.paused must equal outcome === paused`);
  if (!Array.isArray(r.models) || r.models.length > 16 || !r.models.every((m) => typeof m === 'string' && ID.test(m))) out.push(`${at}.models invalid`);
  if (!isPlain(r.tokens) || Object.keys(r.tokens).length > 16) out.push(`${at}.tokens must be an object`);
  else {
    for (const m of Object.keys(r.tokens)) {
      if (!ID.test(m)) out.push(`${at}.tokens: bad model id`);
      else if (shape(r.tokens[m], TOKEN_CLASSES, `${at}.tokens.${m}`, out) && !TOKEN_CLASSES.every((c) => int(r.tokens[m][c], 0, 1e12))) out.push(`${at}.tokens.${m}: counts must be integers`);
    }
  }
  return out;
}

// Secret and path scan. Skipped paths hold values validated by an exact hex pattern instead.
const SECRET = [
  [/sk-[A-Za-z0-9_-]{8,}/, 'token-like string'], [/gh[pousr]_[A-Za-z0-9]{16,}|xox[abprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}/, 'token-like string'],
  [/Bearer\s+\S{10,}/i, 'bearer token'], [/-----BEGIN [A-Z ]*PRIVATE KEY/, 'private key'],
  [/[A-Za-z0-9+/_=-]{40,}/, 'long encoded run'], [/[0-9a-fA-F]{32,}/, 'long hex run'],
  [/\/(?:home|Users|root)\/[^\s/]+|[A-Za-z]:\\+Users\\+/, 'home path'],
];

/** Paths and kinds of secret-like or path-like strings anywhere in `value` (never the strings themselves). */
export function findLeaks(value, { repoRoot, skip = [] } = {}) {
  const out = [];
  const walk = (v, at, depth) => {
    if (depth > 12) { out.push({ at, kind: 'too deep' }); return; }
    if (typeof v === 'string') {
      if (skip.includes(at)) return;
      for (const [re, kind] of SECRET) if (re.test(v)) { out.push({ at, kind }); return; }
      if (typeof repoRoot === 'string' && repoRoot.length >= 4 && v.includes(repoRoot)) out.push({ at, kind: 'repository path' });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`, depth + 1));
    else if (v !== null && typeof v === 'object') {
      for (const k of Object.keys(v)) { walk(k, `${at}.<key>`, depth + 1); walk(v[k], `${at}.${k}`, depth + 1); }
    }
  };
  walk(value, '$', 0);
  return out;
}

/** Every reason `b` is not a valid baseline, including secret and path findings. */
export function baselineProblems(b, opts = {}) {
  const out = [];
  const top = ['schema', 'sha', 'pluginVersion', 'date', 'rule', 'model', 'pinAll', 'host', 'scenarios', 'L0', 'L1', 'L2'];
  if (!shape(b, top, 'baseline', out)) return out;
  if (b.schema !== 1) out.push('schema must be 1');
  if (typeof b.sha !== 'string' || !SHA.test(b.sha)) out.push('sha must be 40 hex characters');
  if (!str(b.pluginVersion)) out.push('pluginVersion must be a string');
  if (typeof b.date !== 'string' || !DATE.test(b.date)) out.push('date must be YYYY-MM-DD');
  if (shape(b.rule, ['version', 'hash'], 'rule', out) && (b.rule.version !== 1 || !HASH.test(b.rule.hash))) out.push('rule version or hash invalid');
  if (shape(b.model, ['alias', 'tier'], 'model', out) && !(str(b.model.alias) && str(b.model.tier))) out.push('model alias and tier must be strings');
  if (typeof b.pinAll !== 'boolean') out.push('pinAll must be a boolean');
  if (shape(b.host, HOST_KEYS, 'host', out)) {
    const h = b.host;
    if (![h.cpuModel, h.osRelease, h.nodeVersion, h.pluginVersion].every(str) || !int(h.cores, 1, 4096) || !int(h.memGb, 1, 1e6)) out.push('host fingerprint fields invalid');
  }
  const ids = [];
  if (!Array.isArray(b.scenarios) || b.scenarios.length < 1 || b.scenarios.length > 64) out.push('scenarios must be 1..64 entries');
  else {
    b.scenarios.forEach((s, i) => {
      if (!shape(s, ['id', 'repeats', 'requiredTier'], `scenarios[${i}]`, out)) return;
      if (!ID.test(s.id) || ids.includes(s.id)) out.push(`scenarios[${i}].id invalid or duplicate`);
      ids.push(s.id);
      if (!int(s.repeats, 1, 1000)) out.push(`scenarios[${i}].repeats invalid`);
      if (s.requiredTier !== null && !str(s.requiredTier)) out.push(`scenarios[${i}].requiredTier invalid`);
    });
  }
  if (shape(b.L0, ['bytes'], 'L0', out)) {
    if (!isPlain(b.L0.bytes)) out.push('L0.bytes must be an object');
    else for (const k of Object.keys(b.L0.bytes)) if (!ID.test(k) || !int(b.L0.bytes[k], 1, 1e12)) out.push('L0.bytes entry invalid');
  }
  if (shape(b.L1, ['events'], 'L1', out)) {
    if (!isPlain(b.L1.events)) out.push('L1.events must be an object');
    else {
      for (const k of Object.keys(b.L1.events)) {
        const xs = b.L1.events[k];
        if (!ID.test(k) || !Array.isArray(xs) || xs.length < 1 || xs.length > MAX_SAMPLES || !xs.every((x) => num(x, 1e-6, 1e9))) out.push('L1.events entry invalid');
      }
    }
  }
  if (shape(b.L2, ['rows'], 'L2', out)) {
    if (!Array.isArray(b.L2.rows) || b.L2.rows.length > MAX_ROWS) out.push('L2.rows must be an array');
    else b.L2.rows.forEach((r, i) => {
      const p = rowProblems(r, `L2.rows[${i}]`);
      out.push(...p);
      if (p.length === 0 && !ids.includes(r.scenario)) out.push(`L2.rows[${i}].scenario is not in the scenario list`);
    });
  }
  for (const l of findLeaks(b, { repoRoot: opts.repoRoot, skip: ['$.sha', '$.rule.hash'] })) out.push(`secret or path pattern (${l.kind}) at ${l.at}`);
  return out;
}
