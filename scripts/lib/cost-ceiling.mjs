// cost-ceiling.mjs — the session cost ceiling: the tier every dispatch runs at unless an agent has
// its own override in .somi/config.json.
//
// The ceiling is re-resolved on every call, nothing is frozen once. Precedence, highest first:
//   1. a value given THIS call: an argument the caller parsed itself (a CLI flag) or SOMI_COST_CEILING
//   2. `cost.ceiling` in .somi/config.json, read live on every call
//   3. a ceiling persisted by an earlier call, but only one that call took from a CLI flag or the env
//      var (a ceiling someone explicitly set), and only when the config sets none
//   4. DEFAULT_CEILING
// So a bare edit to .somi/config.json moves the ceiling on the very next dispatch. That reverses the
// older rule (and the loop-cap precedent in scripts/somi-loop.mjs) under which a config edit could
// not move a ceiling already in force. A persisted ceiling that was itself taken from the config,
// the default, or from before origins were recorded never outranks 2 or 4 -- it yields, so it can
// not pin a stale value after a config fix or a change of default.
//
// Only a CLI/env value is ever written to disk. Every value that reaches validateCeiling() is
// rejected outright if it isn't one of VALID_COSTS -- never coerced -- so a malformed value dies
// loudly instead of quietly disabling the ceiling.
//
// State is deliberately NOT keyed by slug (unlike loop state): the ceiling bounds an operator's
// spend for the whole session, not one slice of work, so one file covers every dispatch.
// Callers pass `root` explicitly rather than this module sniffing CLAUDE_PROJECT_DIR itself --
// keeps the module a pure library over explicit inputs, testable without env-var setup.
//
// Every raise is appended to `ceiling_overrides`, shaped {field, from, to, source, at} -- the same
// shape somi-loop.mjs's `cap_overrides` uses, so an override record looks the same wherever it's
// read from. Created lazily, only on the first real override.

import fs from 'node:fs';
import path from 'node:path';
import { resolveModel, VALID_COSTS } from './cost-model.mjs';
import { validateCostConfig, quote } from './cost-config.mjs';

export const CEILING_ENV = 'SOMI_COST_CEILING';
export const DEFAULT_CEILING = 'medium';
export const ACTIONS = Object.freeze(['allow']);

const ORDER = Object.freeze(Object.fromEntries(VALID_COSTS.map((c, i) => [c, i])));

export function ceilingStatePath(root) {
  return path.join(root, '.somi', 'somi-state', 'ceiling.json');
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// A committed config is untrusted input, read whole into memory and into the model's reach; a file
// this large is not a config, so it is refused rather than parsed.
export const MAX_CONFIG_BYTES = 64 * 1024;

// Opened with O_NOFOLLOW (a committed symlink -- say to /dev/zero -- is refused, never followed) and
// O_NONBLOCK (a FIFO cannot hang the open), then checked on the open descriptor, not the path, so
// there is no stat-then-read race. At most MAX_CONFIG_BYTES+1 bytes are ever read.
const OPEN_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);

function readTextFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, OPEN_FLAGS);
  } catch (e) {
    if (e.code === 'ELOOP') throw new Error(`cost-ceiling: ${file} is a symlink; refusing to follow it`);
    throw e;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error(`cost-ceiling: ${file} is not a regular file`);
    const buf = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let n = 0;
    while (n < buf.length) {
      const got = fs.readSync(fd, buf, n, buf.length - n, null);
      if (got === 0) break;
      n += got;
    }
    if (n > MAX_CONFIG_BYTES) throw new Error(`cost-ceiling: ${file} is over the ${MAX_CONFIG_BYTES}-byte limit`);
    return buf.toString('utf8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

// The parser's own message quotes file text (untrusted, and it reaches the model), so only its error
// name and numeric position are reported.
function parseFailure(file, e) {
  const pos = /position (\d+)/.exec(String(e.message))?.[1];
  return new Error(`cost-ceiling: ${file} is not valid JSON (${JSON.stringify(e.name)}${pos ? ` at position ${pos}` : ''})`);
}

function readConfig(root) {
  const file = path.join(root, '.somi', 'config.json');
  let raw;
  try {
    raw = readTextFile(file);
  } catch (e) {
    if (e.code === 'ENOENT') return {}; // no config committed: nothing configured, defaults apply
    throw e;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    // A committed config that fails to PARSE is not "unconfigured" -- silently returning {} here
    // would bootstrap DEFAULT_CEILING and PERSIST it, inverting a team's `low` policy until
    // someone notices, and outliving the typo once fixed. Dies loudly, naming the file.
    throw parseFailure(file, e);
  }
}

// A `cost` that isn't an object, has an unrecognized key (a typo), or a `ceiling` misplaced at
// the top level all die loudly here instead of silently resolving to "not configured".
//
// Exported: this is also the one config reader scripts/somi-dispatch.mjs uses to pull `mapping`
// (its `ceiling` sibling), so a project's cost config is never parsed by two independent readers
// that could drift on what counts as malformed.
export function readCostConfig(root) {
  const cfg = readConfig(root);
  if (cfg.ceiling !== undefined) {
    throw new Error('cost-ceiling: "ceiling" in .somi/config.json belongs under "cost.ceiling"');
  }
  return validateCostConfig(cfg.cost);
}

function validateCeiling(raw, label) {
  if (!VALID_COSTS.includes(raw)) {
    throw new Error(`cost-ceiling: ${label} expected one of ${VALID_COSTS.join('|')}, got ${quote(raw)}`);
  }
  return raw;
}

// What produced a persisted ceiling. Only `cli` and `env` are ever written now; `config` and `default`
// are what earlier versions wrote, and are accepted (never rewritten) so an old state file still
// loads. A state file with no origin at all (one written before origins were recorded) is legacy: it yields.
const VALID_ORIGINS = Object.freeze(['config', 'cli', 'env', 'default']);
const EXPLICIT_ORIGINS = Object.freeze(['cli', 'env']);

function validateOrigin(raw, label) {
  if (!VALID_ORIGINS.includes(raw)) {
    throw new Error(`cost-ceiling: ${label} expected one of ${VALID_ORIGINS.join('|')}, got ${quote(raw)}`);
  }
  return raw;
}

function saveState(root, state) {
  const file = ceilingStatePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Written to a fresh exclusive temp file (O_NOFOLLOW) and renamed over the target: the rename
  // replaces a symlink planted at ceiling.json instead of writing through it, and a reader never
  // sees a half-written file.
  const tmp = `${file}.${process.pid}.tmp`;
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);
  try {
    const fd = fs.openSync(tmp, flags, 0o666);
    try { fs.writeSync(fd, JSON.stringify(state)); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

// Returns the persisted state, or undefined when there is none. A PRESENT but corrupt file is not
// silently treated as missing -- it throws, same "malformed dies loudly" discipline as a bad
// CLI/env value. Read with the same no-follow, regular-file, size-bounded helper as the config.
function loadState(root) {
  const file = ceilingStatePath(root);
  let raw;
  try {
    raw = readTextFile(file);
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  }
  // An unparsable state file must still name the file in its error -- a bare JSON.parse throw would
  // surface as an unattributed SyntaxError, leaving a caller no path to report which file is corrupt.
  let state;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    throw parseFailure(file, e);
  }
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`cost-ceiling: ${file} is not a valid state object`);
  }
  state.ceiling = validateCeiling(state.ceiling, `ceiling in ${file}`);
  // Absent entirely is legacy (it yields), not corruption; present but wrong is rejected.
  if (state.ceiling_origin !== undefined) validateOrigin(state.ceiling_origin, `ceiling_origin in ${file}`);
  return state;
}

/**
 * Re-resolves the session ceiling for one dispatch. `explicitArg` is a value the caller already
 * extracted THIS invocation (e.g. a parsed CLI flag) -- distinct from SOMI_COST_CEILING, read here.
 * Precedence is in this file's header: explicit (arg, then env) > config > persisted CLI/env > default.
 * `source` names where THIS call's effective ceiling came from: `cli`, `env`, `config`, `state` (a
 * ceiling persisted by an earlier CLI/env call) or `default`. `ceiling_origin` is what produced the
 * value: the same, except a `state` ceiling reports the `cli`/`env` that originally set it.
 * A CLI/env value that differs from what is persisted is saved (with an override record); that is the
 * only write this function makes.
 * @returns {{ceiling: string, overridden: boolean, source: string, ceiling_origin: string, override?: object}}
 */
export function resolveCeiling(root, explicitArg) {
  const state = loadState(root);
  const configured = readCostConfig(root).ceiling;
  const isConfigured = !(configured === undefined || configured === null || configured === '');
  const isCli = explicitArg !== undefined && explicitArg !== '';
  const envVal = process.env[CEILING_ENV];
  const explicit = isCli ? explicitArg : (envVal === undefined || envVal === '' ? undefined : envVal);

  if (explicit === undefined) {
    if (isConfigured) {
      const ceiling = validateCeiling(configured, 'cost.ceiling in .somi/config.json');
      return { ceiling, overridden: false, source: 'config', ceiling_origin: 'config' };
    }
    if (state && EXPLICIT_ORIGINS.includes(state.ceiling_origin)) {
      return { ceiling: state.ceiling, overridden: false, source: 'state', ceiling_origin: state.ceiling_origin };
    }
    return { ceiling: DEFAULT_CEILING, overridden: false, source: 'default', ceiling_origin: 'default' };
  }

  // A config that sets a ceiling is validated even when a CLI/env value outranks it: a typo there
  // should surface now, not on the later call that lacks the flag.
  if (isConfigured) validateCeiling(configured, 'cost.ceiling in .somi/config.json');
  const source = isCli ? 'cli' : 'env';
  const validated = validateCeiling(explicit, isCli ? '--ceiling' : CEILING_ENV);
  const persisted = state && EXPLICIT_ORIGINS.includes(state.ceiling_origin) ? state : undefined;
  // Nothing to do only when the stored value already matches AND no differing config is being raised
  // over (then the effective ceiling changes and the raise is recorded below).
  const configDiffers = isConfigured && configured !== validated;
  if (persisted && persisted.ceiling === validated && persisted.ceiling_origin === source && !configDiffers) {
    return { ceiling: validated, overridden: false, source, ceiling_origin: source };
  }
  const next = state ?? {};
  // The override record's `from` is the ceiling that was in force before this call.
  const from = isConfigured ? configured : (persisted ? persisted.ceiling : DEFAULT_CEILING);
  next.ceiling = validated;
  next.ceiling_origin = source;
  if (from === validated) {
    saveState(root, next);
    return { ceiling: validated, overridden: false, source, ceiling_origin: source };
  }
  const override = { field: 'ceiling', from, to: validated, source, at: nowIso() };
  if (!Array.isArray(next.ceiling_overrides)) next.ceiling_overrides = [];
  // A repeat of the identical raise (same flag every call, config unchanged) is not a new event.
  const last = next.ceiling_overrides[next.ceiling_overrides.length - 1];
  if (!(last && last.from === from && last.to === validated && last.source === source)) next.ceiling_overrides.push(override);
  saveState(root, next);
  return { ceiling: validated, overridden: true, source, ceiling_origin: source, override };
}

// A declared `cost` is a CAPABILITY SET, not a single value -- every tier the unit can usefully
// run at (a frontmatter `cost: medium, high` split on comma). Accepts a bare string too, as a
// one-member set, so a single-tier unit's declaration needs no special-casing at the call site.
// Always returns a frozen array in ascending order -- the same shape validate.sh already enforces
// on a frontmatter declaration, re-checked here rather than trusted: this is a library over
// explicit inputs, and a malformed set must die loudly rather than be silently coerced into
// something valid -- the same discipline validateCeiling() above applies to the ceiling value.
function normalizeCostSet(costs, label) {
  const arr = Array.isArray(costs) ? costs : [costs];
  if (arr.length === 0) {
    throw new Error(`cost-ceiling: ${label} must declare at least one cost value`);
  }
  let prevRank = -1;
  for (const c of arr) {
    if (!VALID_COSTS.includes(c)) {
      throw new Error(`cost-ceiling: ${label} has an unrecognized value "${c}" (expected one of ${VALID_COSTS.join('|')})`);
    }
    const rank = ORDER[c];
    if (rank <= prevRank) {
      throw new Error(`cost-ceiling: ${label} must be strictly ascending with no duplicates, got "${arr.join(',')}"`);
    }
    prevRank = rank;
  }
  return Object.freeze([...arr]);
}

/**
 * Selects the tier a dispatch runs at. The ceiling is a HARD cap with one escape hatch:
 *
 *  - `override` given (the agent's `cost.agents.<name>` from config) -> `selected` is the override,
 *    even above the ceiling. `tier_source` is `"override"`.
 *  - no override -> `selected` is the CEILING tier itself, whatever the unit declared (not the
 *    highest declared member, not a min() of the two). `tier_source` is `"ceiling"`.
 *
 * `costs` (the unit's frontmatter capability set, a string or an ascending duplicate-free array) is
 * read only to report: `supported` echoes it, and `degraded` is true when `selected` ranks below
 * its highest member. It never changes `selected`. This reverses the old never-degrade rule, which
 * ran a unit at its cheapest declared tier when none fit under the ceiling.
 *
 * Pure and deterministic; the result is frozen so a caller can't rewrite the selection.
 */
export function decideDispatch(costs, ceiling, override) {
  const supported = normalizeCostSet(costs, 'declared cost');
  if (!VALID_COSTS.includes(ceiling)) {
    throw new Error(`cost-ceiling: unrecognized ceiling "${ceiling}" (expected one of ${VALID_COSTS.join('|')})`);
  }
  if (override !== undefined && !VALID_COSTS.includes(override)) {
    throw new Error(`cost-ceiling: unrecognized override "${override}" (expected one of ${VALID_COSTS.join('|')})`);
  }
  const selected = override === undefined ? ceiling : override;
  const degraded = ORDER[selected] < ORDER[supported[supported.length - 1]];
  return Object.freeze({
    action: 'allow',
    selected,
    supported,
    ceiling,
    degraded,
    tier_source: override === undefined ? 'ceiling' : 'override',
  });
}

/**
 * The only sanctioned way to turn a decideDispatch() result into a model. `decideDispatch` always
 * returns "allow" now, so this guard is unreachable by construction -- kept anyway as the
 * structural closer: nothing can hand this function a decision that wasn't produced by
 * `decideDispatch`'s own selection and expect a model back.
 */
export function modelForDispatch(decision, host, mapping) {
  if (!decision || decision.action !== 'allow') {
    throw new Error(
      `cost-ceiling: modelForDispatch requires an "allow" decision (one of ${ACTIONS.join('|')}), got "${decision?.action}"`
    );
  }
  return resolveModel(decision.selected, host, mapping);
}
