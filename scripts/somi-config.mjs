#!/usr/bin/env node
// somi-config.mjs — show and change the cost settings in SoMi's config: the global file every project
// and session reads, and a project's .somi/config.json merged over it (scripts/lib/config-files.mjs).
//
//   show                          one JSON line: both files, the ceiling, and every agent's effective
//                                 tier (the resolver's own rule: the agent's cost.agents entry, else the
//                                 ceiling) in the merged config, each with the file it came from, plus
//                                 fixed warnings
//   get cost.ceiling | cost.agents.<name>
//   set cost.ceiling <low|medium|high> | set cost.agents.<name> <low|medium|high>
//   set cost.mapping.<host>.<tier> <model-id[,model-id...]>   (a preference list, first offered wins)
//   unset cost.agents.<name> | unset cost.mapping.<host>
//   init                          create the default file when absent (the exact text the SessionStart
//                                 hook writes); a no-op if anything exists at the path, and for the
//                                 project file also when a global config exists (it holds the defaults)
//   [--global]                    (set, unset, init) change the global file instead of the project's.
//                                 For the user to run: the somi_config MCP tool never passes it
//   [--project-dir DIR]           default: CLAUDE_PROJECT_DIR, else the current directory
//   [--host NAME]                 (show) the host this session runs on; adds a warning when that host has
//                                 no model mapping while any agent resolves to high (#36)
//   [--refuse-lowering]           (set, unset) exit 64 and write nothing if the change would lower any
//                                 agent's effective tier (see scripts/lib/cost-lowering.mjs)
//
// Only those keys can be changed. Any cost.mapping change counts as needing the user (cost-lowering.mjs),
// so --refuse-lowering refuses it: which model a tier means cannot be ranked here. The config is read on every dispatch, so a set or unset takes effect
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
// Safety: the committed config is untrusted. show and get read it as the resolver does (bounded to
// 64 KiB, regular files only, links followed so a junction or symlinked .somi works), and the whole
// `cost` block is validated by the shared validator before and after an edit. A project write goes to
// a fresh temp file in the same .somi directory (O_EXCL, no-follow) and is renamed over config.json, so
// a reader never sees half a file and nothing is written through a link: a symlinked .somi or
// config.json is refused for set, unset and init. The global file is the user's own: a write to it
// follows a link to the real file (a dotfiles setup keeps its link) and creates missing parent
// directories. A lowering is judged on the merged config, before and after. Output is pure ASCII and
// no message echoes text from a file (values are quoted and bounded).
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
import { ConfigFileError, globalConfigPath, loadConfig, mergeConfig, readConfigText } from './lib/config-files.mjs';
import { quote } from './lib/cost-config.mjs';
import { VALID_COSTS, HOST_MODELS } from './lib/cost-model.mjs';
import { AGENT_DEFAULT_TIERS, serializeDefaultConfig } from './lib/cost-defaults.mjs';
import { EditError, applyEdit, parseKey, validateCostBlock, missingMappingTiers } from './lib/cost-config-edit.mjs';
import { lowers, REASONS } from './lib/cost-lowering.mjs';

const PROG = 'somi-config';
const USAGE = `usage: ${PROG}.mjs show [--host NAME] | get <key> | set <key> <value> | unset <key> | init  [--project-dir DIR] [--global] [--refuse-lowering]  (keys: cost.ceiling, cost.agents.<name>, cost.mapping.<host>.<tier> = model-id[,model-id...]; unset cost.agents.<name> or cost.mapping.<host>)`;
const HOST_RE = /^[a-z][a-z0-9-]{0,31}$/;
const EXIT_USAGE = 64;
const EXIT_PROJECT = 67;

const SEC_WARNING = 'somi-security-reviewer runs below high; pin it with: set cost.agents.somi-security-reviewer high';
const ENV_WARNING = 'SOMI_COST_CEILING is set in this environment and outranks cost.ceiling in the config';
const STATE_WARNING = 'a ceiling set earlier by a flag or SOMI_COST_CEILING is in force because cost.ceiling is not set in the config';
const GLOBAL_ONLY_WARNING = 'that value is set in your global config, not this project, so nothing changed here; change it with --global (run the CLI yourself)';
const UNKNOWN_WARNING = 'that agent name is not a shipped agent; the entry is accepted but may never be used';
const unmappedWarning = (host, n) => `${host} has no model mapping, so ${n} high-tier agent(s) run on whatever model the host picks; set cost.mapping.${host} with low, medium and high (docs/USAGE.md, "Pinning models per tier on Copilot")`;
const MAPPING_MESSAGE = 'this change remaps a tier to a different model and needs the user: ask them to run node scripts/somi-config.mjs themselves or edit .somi/config.json';
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
  let global = false;
  let host;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--refuse-lowering') refuse = true;
    else if (rest[i] === '--global') global = true;
    else if (rest[i] === '--host') {
      if (host !== undefined) usage('--host given twice');
      host = rest[++i];
      if (host === undefined || !HOST_RE.test(host)) usage(`--host must match ${HOST_RE}`);
    }
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
  if (host !== undefined && cmd !== 'show') usage('--host applies to show only');
  if (global && !['set', 'unset', 'init'].includes(cmd)) usage('--global applies to set, unset and init');
  return { cmd, pos, dir, refuse, host, global };
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

// -> {somi, file, dirExists, fileExists}; refuses a .somi that is not a real directory. Writes only:
// show and get read through links.
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

// The global file to write: its real path when it exists (a link is followed to it), and the stat of
// the directory it sits in, which writeAtomic re-checks. Parent directories are created when missing.
function locateGlobal() {
  const g = globalConfigPath();
  if (g === null) usage('there is no global config file: SOMI_GLOBAL_CONFIG is set to an empty value');
  let file = g;
  try { file = fs.realpathSync(g); } catch (e) { if (e.code !== 'ENOENT') project('the global config cannot be resolved'); }
  const somi = path.dirname(file);
  const fileExists = fs.existsSync(file);
  return { somi, file, dirExists: fs.existsSync(somi), fileExists, global: true, shown: g };
}

// The merged config and both files, for reading; any problem with either file is 67.
function loadAll(root) {
  try { return loadConfig(root); } catch (e) {
    if (e instanceof ConfigFileError) return project(e.message);
    throw e;
  }
}

// -> the parsed config object ({} when absent), with its whole cost block validated. With
// `forWrite`, also refuses a file a rewrite could not reproduce faithfully. A project file is read
// without following a link (it is about to be replaced); the global file through one.
function load(root, loc, forWrite = false) {
  if (!loc.fileExists) return {};
  let text; let cfg;
  try { text = loc.global ? readConfigText(loc.file) : readTextFile(loc.file); } catch (e) { project(String(e.message).replace(/^cost-ceiling: /, '')); }
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
  for (const host of Object.keys(cost?.mapping ?? {}).sort()) {
    const missing = missingMappingTiers(cost, host);
    if (missing.length) w.push(`cost.mapping.${host} has no ${missing.join(', ')} entry yet, so a dispatch at that tier on ${host} fails until it is set`);
  }
  if (force.source === 'env' && cost?.ceiling !== undefined && cost.ceiling !== force.value) w.push(ENV_WARNING);
  if (force.source === 'state') w.push(STATE_WARNING);
  if (effective('somi-security-reviewer', cost, force.value).tier !== 'high') w.push(SEC_WARNING);
  return w;
}

// Which file a merged cost value came from: the project file when it sets it, else the global one.
const fromFile = (files, get) => (get(files.project.config) !== undefined ? 'project' : 'global');

function show(root, files, host) {
  const cfg = files.config;
  const cost = cfg.cost ?? {};
  const force = ceilingInForce(root, cost);
  const names = Object.keys(AGENT_DEFAULT_TIERS).sort();
  const extras = Object.keys(cost.agents ?? {}).filter((n) => !(n in AGENT_DEFAULT_TIERS)).sort();
  const agent = (name, unknown) => {
    const e = effective(name, cost, force.value);
    const from = e.source === 'override' ? { from: fromFile(files, (c) => c.cost?.agents?.[name]) } : {};
    return { name, tier: e.tier, source: e.source, ...from, default: unknown ? null : AGENT_DEFAULT_TIERS[name], ...(unknown ? { unknown: true } : {}) };
  };
  const agents = [...names.map((n) => agent(n, false)), ...extras.map((n) => agent(n, true))];
  const extra = [];
  const mapped = host !== undefined && (Object.hasOwn(HOST_MODELS, host) || (cost.mapping && Object.hasOwn(cost.mapping, host)));
  const highs = agents.filter((a) => a.tier === 'high').length;
  if (host !== undefined && !mapped && highs > 0) extra.push(unmappedWarning(host, highs));
  return {
    path: path.join('.somi', 'config.json'),
    exists: files.project.present,
    global: { path: files.global.path, exists: files.global.present },
    ceiling: cost.ceiling === undefined ? { value: DEFAULT_CEILING, source: 'default' } : { value: cost.ceiling, source: 'config', from: fromFile(files, (c) => c.cost?.ceiling) },
    effective_ceiling: force,
    agents,
    warnings: warningsFor(cost, force, extra),
  };
}

// Key and tier errors are the caller's (64).
const edit = (fn) => { try { return fn(); } catch (e) { if (e instanceof EditError) return usage(e.message); throw e; } };

function ensureSomi(loc) {
  if (loc.global) {
    try { fs.mkdirSync(loc.somi, { recursive: true, mode: 0o700 }); loc.dirStat = fs.statSync(loc.somi); } catch { project('the global config directory could not be created'); }
    if (!loc.dirStat.isDirectory()) project('the global config directory is not a directory');
    return;
  }
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
    const now = loc.global ? fs.statSync(loc.somi, { throwIfNoEntry: false }) : lstatOrNull(loc.somi);
    if (!now || !now.isDirectory() || now.dev !== loc.dirStat.dev || now.ino !== loc.dirStat.ino) project(`${loc.global ? 'the global config directory' : '.somi'} changed while writing; nothing was replaced`);
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
  const { cmd, pos, dir, refuse, host, global } = parseArgs(process.argv.slice(2));
  const root = projectRoot(dir);
  const writes = cmd === 'set' || cmd === 'unset' || cmd === 'init';
  // Only a write inspects the target's links; show and get read through them.
  const loc = !writes ? null : (global ? locateGlobal() : locate(root));
  const rel = global ? loc.shown : path.join('.somi', 'config.json');

  if (cmd === 'init') {
    if (loc.fileExists) return { path: rel, created: false };
    const g = global ? null : globalConfigPath();
    if (g !== null && fs.lstatSync(g, { throwIfNoEntry: false })) return { path: rel, created: false, reason: 'a global config exists and holds the defaults' };
    ensureSomi(loc);
    return { path: rel, created: writeAtomic(loc, serializeDefaultConfig(), { noClobber: true }) };
  }

  const files = loadAll(root);
  const k = cmd === 'show' ? null : edit(() => parseKey(pos[0]));
  if (cmd === 'unset' && !(k.kind === 'agent' || (k.kind === 'mapping' && k.tier === undefined))) usage('only cost.agents.<name> and cost.mapping.<host> can be unset');
  if (files.config.ceiling !== undefined) project('"ceiling" at the top level of config.json belongs under "cost.ceiling"');
  checkCost(files.config.cost, project);
  if (cmd === 'show') return show(root, files, host);

  if (cmd === 'get') {
    const merged = files.config.cost;
    const force = ceilingInForce(root, merged);
    if (k.kind === 'ceiling') return { key: pos[0], value: merged?.ceiling ?? DEFAULT_CEILING, source: merged?.ceiling === undefined ? 'default' : 'config', effective_ceiling: force };
    if (k.kind === 'mapping') {
      const hostMap = merged?.mapping?.[k.host];
      const value = hostMap === undefined ? null : (k.tier === undefined ? hostMap : (hostMap[k.tier] ?? null));
      return { key: pos[0], value, source: value === null ? 'none' : 'config' };
    }
    const has = merged?.agents && Object.hasOwn(merged.agents, k.name);
    return { key: pos[0], value: has ? merged.agents[k.name] : null, source: has ? 'override' : 'none' };
  }

  // set/unset edit one file. A set on an absent file starts from the default file, so the default
  // pins exist -- except a project file over a global config, which starts empty: the global file
  // holds the defaults, and copies of them in the project would mask later global changes.
  const cfg = load(root, loc, true);
  const absent = !loc.fileExists;
  const start = absent && !global && files.global.present ? {} : (absent ? null : cfg);
  // What the resolver sees, before and after: a project edit is judged merged over the global file;
  // a global edit on its own, since it applies to projects whose files differ.
  const view = (c) => (global ? c : mergeConfig(files.global.config, c ?? {}));
  const beforeCfg = view(absent ? {} : cfg);
  const { next, changed } = edit(() => applyEdit(start, { action: cmd, key: pos[0], value: pos[1] }));
  if (!changed) {
    // Nothing to unset in the project, but the same unset would change the global file: say where it lives.
    const inGlobalOnly = !global && cmd === 'unset' && edit(() => applyEdit(files.global.config, { action: cmd, key: pos[0] })).changed;
    return { path: rel, key: pos[0], changed: false, warnings: warningsFor(beforeCfg.cost, ceilingInForce(root, beforeCfg.cost), inGlobalOnly ? [GLOBAL_ONLY_WARNING] : []) };
  }
  checkCost(next.cost, (m) => usage(m)); // the whole resulting block; a failure here is the caller's input
  const after = view(next);
  if (refuse) {
    const v = lowers(beforeCfg, after, root);
    if (v.lowers) usage(v.reasons.every((r) => r === REASONS.mapping) ? MAPPING_MESSAGE : LOWERING_MESSAGE);
  }
  const value = cmd !== 'set' ? undefined : (k.kind === 'mapping' ? next.cost.mapping[k.host][k.tier] : pos[1]);
  const extra = k.kind === 'agent' && cmd === 'set' && !(k.name in AGENT_DEFAULT_TIERS) && k.name !== 'somi' ? [UNKNOWN_WARNING] : [];
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
  writeAtomic(loc, text, { mode: loc.fileExists ? (fs.statSync(loc.file).mode & 0o777) : undefined });
  return { path: rel, key: pos[0], ...(cmd === 'set' ? { value } : {}), changed, effective_ceiling: ceilingInForce(root, after.cost), warnings: warningsFor(after.cost, ceilingInForce(root, after.cost), extra) };
}

try {
  const out = main();
  process.stdout.write(`${ascii(out)}\n`);
} catch (e) {
  if (e instanceof ExitSignal) process.exitCode = e.code;
  else throw e;
}
