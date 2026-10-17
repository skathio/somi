#!/usr/bin/env node
// somi-config.mjs — show and change the cost settings in a project's .somi/config.json.
//
//   show                          one JSON line: where the file is, the ceiling, and every agent's
//                                 effective tier (the resolver's own rule: the agent's cost.agents entry,
//                                 else the ceiling), plus fixed warnings
//   get cost.ceiling | cost.agents.<name>
//   set cost.ceiling <low|medium|high> | set cost.agents.<name> <low|medium|high>
//   unset cost.agents.<name>
//   init                          create the default file when absent (the exact text the SessionStart
//                                 hook writes); a no-op if anything exists at the path
//   [--project-dir DIR]           default: CLAUDE_PROJECT_DIR, else the current directory
//   [--refuse-lowering]           (set, unset) exit 64 and write nothing if the change would lower any
//                                 agent's effective tier (see scripts/lib/cost-lowering.mjs)
//
// Only those keys can be changed. The config is read on every dispatch, so a set or unset takes effect
// on the very next resolve. Everything else in the file is preserved as parsed.
//
// A set or unset rewrites the whole file, so it refuses (67, nothing written) any file whose content
// would not survive a round trip through JSON.parse/JSON.stringify: a duplicate key, an integer beyond
// the safe range, or a number outside the double range, anywhere in the file; text whose rewrite would
// exceed the 64 KiB limit the reader enforces; or nesting too deep to serialise. Other formatting
// (indentation, key spacing, float spelling such as 1.0) is normalised to 2-space JSON. The temp file is
// created in .somi and fsynced; .somi's identity is re-checked just before the rename. A same-user
// process that swaps .somi in that last instant, or edits config.json between our read and rename, is
// not defended against (the edit would be lost). A replaced file keeps the original's permission bits.
//
// With the ceiling, `show` and the output of `set` report what the resolver would use: the
// SOMI_COST_CEILING variable, else cost.ceiling, else a ceiling persisted by an earlier --ceiling or
// env call, else the built-in default (`effective_ceiling`), and warn when the variable or a
// persisted value is why it differs from the config.
//
// Safety: the committed config is untrusted. It is read with the same bounded (64 KiB), no-follow,
// regular-file reader the resolver uses, and the whole `cost` block is validated by the shared
// validator before and after an edit. A write goes to a fresh temp file in the same .somi directory
// (O_EXCL, no-follow) and is renamed over config.json, so a reader never sees half a file and nothing
// is written through a link. A symlinked .somi or config.json is refused. Output is pure ASCII and no
// message echoes text from the file (values are quoted and bounded).
//
// Exit codes (callers branch on these — do not repurpose):
//   0   ok
//   64  usage: bad arguments, a key that may not be set, a bad tier or agent name
//   67  the project's files: .somi or config.json unreadable, oversize, a link, not valid JSON, or an
//       invalid cost block (nothing is written); also a failed write
// Nothing is printed to stdout on an error path. Zero-dependency: stdlib only.

import fs from 'node:fs';
import path from 'node:path';
import { readTextFile, loadState, decideDispatch, DEFAULT_CEILING, MAX_CONFIG_BYTES } from './lib/cost-ceiling.mjs';
import { quote } from './lib/cost-config.mjs';
import { VALID_COSTS } from './lib/cost-model.mjs';
import { AGENT_DEFAULT_TIERS, serializeDefaultConfig } from './lib/cost-defaults.mjs';
import { EditError, applyEdit, parseKey, validateCostBlock } from './lib/cost-config-edit.mjs';
import { lowers } from './lib/cost-lowering.mjs';

const PROG = 'somi-config';
const USAGE = `usage: ${PROG}.mjs show | get <key> | set <key> <tier> | unset cost.agents.<name> | init  [--project-dir DIR] [--refuse-lowering]  (keys: cost.ceiling, cost.agents.<name>)`;
const EXIT_USAGE = 64;
const EXIT_PROJECT = 67;

const SEC_WARNING = 'security-reviewer runs below high; pin it with: set cost.agents.security-reviewer high';
const ENV_WARNING = 'SOMI_COST_CEILING is set in this environment and outranks cost.ceiling in the config';
const STATE_WARNING = 'a ceiling set earlier by a flag or SOMI_COST_CEILING is in force because cost.ceiling is not set in the config';
const UNKNOWN_WARNING = 'that agent name is not a shipped agent; the entry is accepted but may never be used';
const LOWERING_MESSAGE = 'this change lowers a tier and needs the user: ask them to run node scripts/somi-config.mjs themselves or edit .somi/config.json';
const WRITE_FLAGS = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);

class ExitSignal extends Error {
  constructor(code) { super(`exit ${code}`); this.code = code; }
}
const asciiEscape = (s) => s.replace(/[\u0000-\u001f\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const ascii = (x) => asciiEscape(JSON.stringify(x));
function fail(code, msg, tail = '') {
  process.stderr.write(`${PROG}: ${asciiEscape(msg)}${tail}\n`);
  throw new ExitSignal(code);
}
const usage = (msg) => fail(EXIT_USAGE, msg, `\n${USAGE}`);
const project = (msg) => fail(EXIT_PROJECT, msg);

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const pos = [];
  let dir;
  let refuse = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--refuse-lowering') refuse = true;
    else if (rest[i] === '--project-dir') {
      if (dir !== undefined) usage('--project-dir given twice');
      dir = rest[++i];
      if (dir === undefined || dir === '') usage('--project-dir requires a non-empty value');
    } else if (rest[i].startsWith('--')) usage(`unknown argument: ${quote(rest[i])}`);
    else pos.push(rest[i]);
  }
  const want = { show: 0, get: 1, set: 2, unset: 1, init: 0 };
  if (!Object.hasOwn(want, cmd ?? '')) usage(cmd ? `unknown command: ${quote(cmd)}` : 'a command is required');
  if (pos.length !== want[cmd]) usage(`${cmd} takes ${want[cmd]} argument(s)`);
  if (refuse && cmd !== 'set' && cmd !== 'unset') usage('--refuse-lowering applies to set and unset only');
  return { cmd, pos, dir, refuse };
}

function projectRoot(dir) {
  let base = dir ?? process.env.CLAUDE_PROJECT_DIR ?? '';
  if (base === '' || base.includes('${')) base = dir ?? process.cwd();
  try {
    if (!fs.statSync(base).isDirectory()) usage('the project directory is not a directory');
  } catch (e) {
    if (e instanceof ExitSignal) throw e;
    usage('the project directory cannot be read');
  }
  return path.resolve(base);
}

const lstatOrNull = (p) => { try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

// -> {somi, file, dirExists, fileExists}; refuses a .somi that is not a real directory.
function locate(root) {
  const somi = path.join(root, '.somi');
  const file = path.join(somi, 'config.json');
  let d; let f = null;
  try { d = lstatOrNull(somi); if (d && !d.isDirectory()) project('.somi is a link or not a directory; refusing'); if (d) f = lstatOrNull(file); } catch (e) {
    if (e instanceof ExitSignal) throw e;
    project('.somi cannot be inspected');
  }
  return { somi, file, dirExists: d !== null, fileExists: f !== null, dirStat: d };
}

// Why a rewrite of `text` (already parsed OK) would change its meaning, or null: a duplicate key or a
// number JSON.stringify cannot reproduce. A small scanner; structure is already known to be valid.
function roundTripHazard(text) {
  const stack = [];
  const n = text.length;
  for (let i = 0; i < n;) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (top?.obj && top.expectKey) {
        const key = JSON.parse(text.slice(i, j + 1));
        if (top.keys.has(key)) return 'a duplicate key';
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j + 1;
    } else if (c === '{') { stack.push({ obj: true, keys: new Set(), expectKey: true }); i++; }
    else if (c === '[') { stack.push({ obj: false }); i++; }
    else if (c === '}' || c === ']') { stack.pop(); i++; }
    else if (c === ',') { if (top?.obj) top.expectKey = true; i++; }
    else if (c === '-' || (c >= '0' && c <= '9')) {
      const tok = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400))[0];
      const v = Number(tok);
      if (!Number.isFinite(v)) return 'a number outside the double range';
      if (/^-?\d+$/.test(tok) && !Number.isSafeInteger(v)) return 'an integer beyond the safe range';
      i += tok.length;
    } else i++;
  }
  return null;
}

// -> the parsed config object ({} when absent), with its whole cost block validated. With
// `forWrite`, also refuses a file a rewrite could not reproduce faithfully.
function load(root, loc, forWrite = false) {
  if (!loc.fileExists) return {};
  let text; let cfg;
  try { text = readTextFile(loc.file); } catch (e) { project(String(e.message).replace(/^cost-ceiling: /, '')); }
  try { cfg = JSON.parse(text); } catch { project('config.json is not valid JSON'); }
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) project('config.json is not a JSON object');
  if (cfg.ceiling !== undefined) project('"ceiling" at the top level of config.json belongs under "cost.ceiling"');
  checkCost(cfg.cost, project);
  if (forWrite) {
    const why = roundTripHazard(text);
    if (why) project(`config.json holds ${why}, which a rewrite would change; edit it by hand`);
  }
  return cfg;
}

function checkCost(cost, onFail) {
  try { validateCostBlock(cost); } catch (e) { onFail(String(e.message).replace(/^cost-ceiling: /, '')); }
}

// What the resolver would use for the ceiling, without writing state: SOMI_COST_CEILING, else the
// config, else a ceiling an earlier flag/env call persisted, else the default.
function ceilingInForce(root, cost) {
  const env = process.env.SOMI_COST_CEILING;
  if (env !== undefined && env !== '') {
    if (!VALID_COSTS.includes(env)) usage(`SOMI_COST_CEILING must be one of ${VALID_COSTS.join('|')}, got ${quote(env)}`);
    return { value: env, source: 'env' };
  }
  if (cost?.ceiling !== undefined) return { value: cost.ceiling, source: 'config' };
  let state;
  try { state = loadState(root); } catch (e) { project(String(e.message).replace(/^cost-ceiling: /, '')); }
  if (state && ['cli', 'env'].includes(state.ceiling_origin)) return { value: state.ceiling, source: 'state' };
  return { value: DEFAULT_CEILING, source: 'default' };
}

// The resolver's rule, via the library: the agent's override if present, else the ceiling.
function effective(name, cost, ceiling) {
  const override = cost?.agents && Object.hasOwn(cost.agents, name) ? cost.agents[name] : undefined;
  const declared = AGENT_DEFAULT_TIERS[name] ?? override ?? ceiling;
  const d = decideDispatch(declared, ceiling, override);
  return { tier: d.selected, source: d.tier_source };
}

function warningsFor(cost, force, extra = []) {
  const w = [...extra];
  if (force.source === 'env' && cost?.ceiling !== undefined && cost.ceiling !== force.value) w.push(ENV_WARNING);
  if (force.source === 'state') w.push(STATE_WARNING);
  if (effective('security-reviewer', cost, force.value).tier !== 'high') w.push(SEC_WARNING);
  return w;
}

function show(root, loc, cfg) {
  const cost = cfg.cost ?? {};
  const force = ceilingInForce(root, cost);
  const names = Object.keys(AGENT_DEFAULT_TIERS).sort();
  const extras = Object.keys(cost.agents ?? {}).filter((n) => !(n in AGENT_DEFAULT_TIERS)).sort();
  const agent = (name, unknown) => {
    const e = effective(name, cost, force.value);
    return { name, tier: e.tier, source: e.source, default: unknown ? null : AGENT_DEFAULT_TIERS[name], ...(unknown ? { unknown: true } : {}) };
  };
  return {
    path: path.join('.somi', 'config.json'),
    exists: loc.fileExists,
    ceiling: cost.ceiling === undefined ? { value: DEFAULT_CEILING, source: 'default' } : { value: cost.ceiling, source: 'config' },
    effective_ceiling: force,
    agents: [...names.map((n) => agent(n, false)), ...extras.map((n) => agent(n, true))],
    warnings: warningsFor(cost, force),
  };
}

// Key and tier errors are the caller's (64).
const edit = (fn) => { try { return fn(); } catch (e) { if (e instanceof EditError) return usage(e.message); throw e; } };

function ensureSomi(loc) {
  if (!loc.dirExists) {
    try { fs.mkdirSync(loc.somi, { mode: 0o700 }); } catch (e) {
      if (e.code !== 'EEXIST' || !lstatOrNull(loc.somi)?.isDirectory()) project('.somi could not be created');
    }
  }
  loc.dirStat = lstatOrNull(loc.somi);
  if (!loc.dirStat?.isDirectory()) project('.somi is a link or not a directory; refusing');
}

// Writes `text` to a fresh temp file beside config.json (exclusive, no-follow), fsyncs it, re-checks that
// .somi is still the directory we inspected, and renames it over; with `noClobber` it hard-links instead,
// which fails rather than replace a file that appeared meanwhile. `mode`, when given (replacing an
// existing file), is that file's permission bits; a new file gets 0644 minus the umask.
function writeAtomic(loc, text, { noClobber = false, mode } = {}) {
  const tmp = path.join(loc.somi, `config.json.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, WRITE_FLAGS, 0o644);
    const buf = Buffer.from(text);
    for (let off = 0; off < buf.length;) off += fs.writeSync(fd, buf, off, buf.length - off);
    if (mode !== undefined) fs.fchmodSync(fd, mode);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    const now = lstatOrNull(loc.somi);
    if (!now || !now.isDirectory() || now.dev !== loc.dirStat.dev || now.ino !== loc.dirStat.ino) project('.somi changed while writing; nothing was replaced');
    if (noClobber) fs.linkSync(tmp, loc.file); else fs.renameSync(tmp, loc.file);
    return true;
  } catch (e) {
    if (e instanceof ExitSignal) throw e;
    if (noClobber && e.code === 'EEXIST') return false;
    return project('config.json could not be written');
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ }
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
}

function main() {
  const { cmd, pos, dir, refuse } = parseArgs(process.argv.slice(2));
  const root = projectRoot(dir);
  const loc = locate(root);
  const rel = path.join('.somi', 'config.json');

  if (cmd === 'init') {
    if (loc.fileExists) return { path: rel, created: false };
    ensureSomi(loc);
    return { path: rel, created: writeAtomic(loc, serializeDefaultConfig(), { noClobber: true }) };
  }

  const k = cmd === 'show' ? null : edit(() => parseKey(pos[0]));
  if (cmd === 'unset' && k.kind !== 'agent') usage('only cost.agents.<name> can be unset');
  const cfg = load(root, loc, cmd === 'set' || cmd === 'unset');
  if (cmd === 'show') return show(root, loc, cfg);

  if (cmd === 'get') {
    const force = ceilingInForce(root, cfg.cost);
    if (k.kind === 'ceiling') return { key: pos[0], value: cfg.cost?.ceiling ?? DEFAULT_CEILING, source: cfg.cost?.ceiling === undefined ? 'default' : 'config', effective_ceiling: force };
    const has = cfg.cost?.agents && Object.hasOwn(cfg.cost.agents, k.name);
    return { key: pos[0], value: has ? cfg.cost.agents[k.name] : null, source: has ? 'override' : 'none' };
  }

  // set/unset. A set on an absent file starts from the default file, so the default pins exist.
  const absent = !loc.fileExists;
  const beforeCfg = { cost: JSON.parse(JSON.stringify(cfg.cost ?? null)) };
  const { next, changed } = edit(() => applyEdit(absent ? null : cfg, { action: cmd, key: pos[0], value: pos[1] }));
  if (!changed) return { path: rel, key: pos[0], changed: false, warnings: warningsFor(cfg.cost, ceilingInForce(root, cfg.cost)) };
  checkCost(next.cost, (m) => usage(m)); // the whole resulting block; a failure here is the caller's input
  if (refuse && lowers(beforeCfg, next, root).lowers) usage(LOWERING_MESSAGE);
  const value = cmd === 'set' ? pos[1] : undefined;
  const extra = k.kind === 'agent' && cmd === 'set' && !(k.name in AGENT_DEFAULT_TIERS) && k.name !== 'somi' ? [UNKNOWN_WARNING] : [];
  if (changed) {
    let text;
    try {
      text = `${JSON.stringify(next, null, 2)}\n`;
      if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(next)) project('config.json could not be rewritten faithfully; nothing was written');
    } catch (e) {
      if (e instanceof ExitSignal) throw e;
      project('config.json is too deeply nested to rewrite');
    }
    if (Buffer.byteLength(text) > MAX_CONFIG_BYTES) project('the edited config.json would exceed the size limit; nothing was written');
    ensureSomi(loc);
    writeAtomic(loc, text, { mode: loc.fileExists ? (fs.lstatSync(loc.file).mode & 0o777) : undefined });
  }
  return { path: rel, key: pos[0], ...(cmd === 'set' ? { value } : {}), changed, effective_ceiling: ceilingInForce(root, next.cost), warnings: warningsFor(next.cost, ceilingInForce(root, next.cost), extra) };
}

try {
  const out = main();
  process.stdout.write(`${ascii(out)}\n`);
} catch (e) {
  if (e instanceof ExitSignal) process.exitCode = e.code;
  else throw e;
}
