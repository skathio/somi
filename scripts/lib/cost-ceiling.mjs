// cost-ceiling.mjs — the session cost ceiling: a maximum `cost` tier a dispatch may cross without
// explicit sign-off.
//
// Follows the loop-cap precedent (scripts/somi-loop.mjs's reresolveCap/applyCapOverride): the
// ceiling is re-resolved on every call, not frozen once. Absent an explicit value THIS call (an
// argument the caller parsed itself, or SOMI_COST_CEILING), the ceiling already recorded on disk
// stands unchanged — a bare `.somi/config.json` edit cannot silently move a ceiling already in
// force, because config is consulted only once, when no state file exists yet. Every value that
// reaches validateCeiling() is rejected outright if it isn't one of VALID_COSTS — never coerced —
// so a malformed value dies loudly instead of quietly disabling the ceiling.
//
// State is deliberately NOT keyed by slug (unlike loop state): the ceiling bounds an operator's
// spend for the whole session, not one slice of work, so one file covers every dispatch.
// Callers pass `root` explicitly rather than this module sniffing CLAUDE_PROJECT_DIR itself —
// keeps the module a pure library over explicit inputs, testable without env-var setup.
//
// Every raise is appended to `ceiling_overrides`, shaped {field, from, to, source, at} — the same
// shape somi-loop.mjs's `cap_overrides` uses, so an override record looks the same wherever it's
// read from. Created lazily, only on the first real override.
//
// The ceiling not moving on a bare config edit (above) means `ceiling_origin: "config"` can go
// stale: config can change to a DIFFERENT value after state already exists, without moving what's
// in force. `resolveCeiling` detects this and reports `"config-stale"` instead — never persisted,
// since nothing about the value in force actually changed, only the honesty of naming why. A state
// file written before `ceiling_origin` shipped (no hard failure -- reported as `"unknown"`) is the
// other non-canonical value `resolveCeiling` can return; see LEGACY_ORIGIN below.

import fs from 'node:fs';
import path from 'node:path';
import { resolveModel, VALID_COSTS } from './cost-model.mjs';

export const CEILING_ENV = 'SOMI_COST_CEILING';
export const DEFAULT_CEILING = 'high';
export const ACTIONS = Object.freeze(['allow']);

const ORDER = Object.freeze(Object.fromEntries(VALID_COSTS.map((c, i) => [c, i])));

export function ceilingStatePath(root) {
  return path.join(root, '.somi', 'somi-state', 'ceiling.json');
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function readConfig(root) {
  const file = path.join(root, '.somi', 'config.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return {}; // no config committed: nothing configured, defaults apply
    throw e;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    // A committed config that fails to PARSE is not "unconfigured" -- silently returning {} here
    // would bootstrap DEFAULT_CEILING and PERSIST it, inverting a team's `low` policy until
    // someone notices, and outliving the typo once fixed. Dies loudly instead, naming the file.
    throw new Error(`cost-ceiling: ${file} is not valid JSON: ${e.message}`);
  }
}

const COST_CONFIG_KEYS = new Set(['ceiling', 'mapping']);

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
  const cost = cfg.cost;
  if (cost === undefined || cost === null) return {};
  if (typeof cost !== 'object' || Array.isArray(cost)) {
    throw new Error(`cost-ceiling: cost in .somi/config.json expected an object, got ${JSON.stringify(cost)}`);
  }
  for (const key of Object.keys(cost)) {
    if (!COST_CONFIG_KEYS.has(key)) {
      throw new Error(`cost-ceiling: cost in .somi/config.json has an unrecognized key "${key}"`);
    }
  }
  return cost;
}

function validateCeiling(raw, label) {
  if (!VALID_COSTS.includes(raw)) {
    throw new Error(`cost-ceiling: ${label} expected one of ${VALID_COSTS.join('|')}, got "${raw}"`);
  }
  return raw;
}

// What produced the ceiling value currently on disk -- distinct from `source` (below), which names
// what THIS call did. `ceiling_origin` survives every later bare call that just loads state, so an
// announcement can say WHY a persisted `low` is in force ("you set this via SOMI_COST_CEILING last
// session") instead of only "it's saved state" -- see resolveCeiling's own doc comment.
const VALID_ORIGINS = Object.freeze(['config', 'cli', 'env', 'default']);

// Reported (never persisted) origin for a state file written before `ceiling_origin` existed --
// this repo's own checked-in .somi/somi-state/ceiling.json is exactly that shape. There is no way
// to recover which of config/cli/env/default actually produced the value, so this is the honest
// answer rather than a guess. Distinct from a PRESENT-but-invalid value (a typo, a stale removed
// value), which still dies loudly in loadOrInitState below -- absence is legacy, corruption isn't.
const LEGACY_ORIGIN = 'unknown';

function validateOrigin(raw, label) {
  if (!VALID_ORIGINS.includes(raw)) {
    throw new Error(`cost-ceiling: ${label} expected one of ${VALID_ORIGINS.join('|')}, got "${raw}"`);
  }
  return raw;
}

function saveState(root, state) {
  const file = ceilingStatePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state));
}

// Reads the state file if present. A missing file bootstraps fresh, from
// .somi/config.json's `cost.ceiling` (validated) or DEFAULT_CEILING. A PRESENT but corrupt file is
// not silently treated as missing — it throws, same "malformed dies loudly" discipline as a bad
// CLI/env value, rather than quietly re-arming at the default with the corruption unreported.
//
// Returns `{state, bootstrapSource}` — `bootstrapSource` is `'config'` or `'default'` when this
// call just bootstrapped a fresh state file, or `'state'` when an existing one was loaded. This is
// what lets resolveCeiling() report where a ceiling came from even on a call that overrides
// nothing — a dispatcher can then announce a `low` ceiling honestly, by its real source, not just
// by its bare value.
function loadOrInitState(root) {
  const file = ceilingStatePath(root);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const configured = readCostConfig(root).ceiling;
    const isConfigured = !(configured === undefined || configured === null || configured === '');
    const ceiling = isConfigured
      ? validateCeiling(configured, 'cost.ceiling in .somi/config.json')
      : DEFAULT_CEILING;
    const bootstrapSource = isConfigured ? 'config' : 'default';
    const state = { ceiling, ceiling_origin: bootstrapSource };
    saveState(root, state);
    return { state, bootstrapSource };
  }
  // An unparsable state file (bad JSON, not merely a wrong shape) must still name the file in its
  // error -- a bare JSON.parse throw here would surface as an unattributed SyntaxError, leaving a
  // caller (or a project-environment-failure classifier) no path to report which file is corrupt.
  let state;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    throw new Error(`cost-ceiling: ${file} is not valid JSON: ${e.message}`);
  }
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`cost-ceiling: ${file} is not a valid state object`);
  }
  state.ceiling = validateCeiling(state.ceiling, `ceiling in ${file}`);
  // Absent entirely (a state file written before this field shipped) is legacy, not corruption --
  // report LEGACY_ORIGIN rather than hard-failing a file this repo itself ships checked in. Present
  // but wrong (a typo, a stale removed value) is still rejected the same as any other malformed
  // persisted value.
  state.ceiling_origin = state.ceiling_origin === undefined
    ? LEGACY_ORIGIN
    : validateOrigin(state.ceiling_origin, `ceiling_origin in ${file}`);
  return { state, bootstrapSource: 'state' };
}

// `ceiling_origin: "config"` is a claim -- "a committed project policy produced this value" --
// that a later, DIFFERENT `.somi/config.json` edit silently falsifies. By design (see this file's
// own header) an edit after state already exists does not move the ceiling already in force, so
// reporting the origin unchanged would keep asserting a policy that no longer matches what's
// committed. Detected only when the origin currently on disk still claims 'config' (once a cli/env
// override has moved it, the origin already reflects THAT, correctly) and only against a call that
// LOADED existing state rather than bootstrapping fresh this same call (a fresh bootstrap read
// config and set state from it in this same call, so it cannot yet be stale). Never persisted --
// this changes only what THIS call reports, not the state file itself.
function reportedOrigin(root, state, bootstrapSource) {
  if (bootstrapSource !== 'state' || state.ceiling_origin !== 'config') return state.ceiling_origin;
  const configured = readCostConfig(root).ceiling;
  const unset = configured === undefined || configured === null || configured === '';
  return (unset || configured !== state.ceiling) ? 'config-stale' : state.ceiling_origin;
}

/**
 * Re-resolves the session ceiling for one dispatch. `explicitArg` is a value the caller already
 * extracted THIS invocation (e.g. a parsed CLI flag) — distinct from SOMI_COST_CEILING, read here.
 * Precedence for what can MOVE a ceiling already in force: explicitArg > env var; neither present
 * means the ceiling on disk stands, full stop — `.somi/config.json` is never re-read after the
 * state file first exists.
 * `source` names where THIS call's effective ceiling came from — `cli` or `env` when explicitArg
 * or SOMI_COST_CEILING was read this call (whether or not it actually moved the value), otherwise
 * the ceiling's own origin: `config` or `default` on the call that bootstrapped it, `state` on
 * every later call that just loads what a previous call already persisted.
 * `ceiling_origin` is what actually produced the value now in force — `config`/`cli`/`env`/`default`
 * — and, unlike `source`, it survives every later bare call. `source: "state"` alone only tells a
 * caller a ceiling was already on disk; `ceiling_origin` is what lets an announcement say WHY (a
 * committed team policy, or an explicit `cli`/`env` set in an earlier session) instead of only
 * "it's saved state". Two further values it can report, neither ever persisted: `config-stale` —
 * the value was bootstrapped from `.somi/config.json`, but that file's `cost.ceiling` has since
 * changed to something else (or been removed) — and `unknown` — a state file written before this
 * field existed (this repo's own committed state is exactly that shape).
 * @returns {{ceiling: string, overridden: boolean, source: string, ceiling_origin: string, override?: object}}
 */
export function resolveCeiling(root, explicitArg) {
  const { state, bootstrapSource } = loadOrInitState(root);
  const isCli = explicitArg !== undefined && explicitArg !== '';
  const envVal = process.env[CEILING_ENV];
  const explicit = isCli ? explicitArg : (envVal === undefined || envVal === '' ? undefined : envVal);
  if (explicit === undefined) {
    return { ceiling: state.ceiling, overridden: false, source: bootstrapSource, ceiling_origin: reportedOrigin(root, state, bootstrapSource) };
  }
  const source = isCli ? 'cli' : 'env';
  const validated = validateCeiling(explicit, isCli ? '--ceiling' : CEILING_ENV);
  if (validated === state.ceiling) {
    return { ceiling: state.ceiling, overridden: false, source, ceiling_origin: reportedOrigin(root, state, bootstrapSource) };
  }
  const override = {
    field: 'ceiling',
    from: state.ceiling,
    to: validated,
    source,
    at: nowIso(),
  };
  state.ceiling = validated;
  // The value now in force was produced by THIS override, not by whatever bootstrapped the file --
  // ceiling_origin tracks the origin of the CURRENT value, so it must move with it.
  state.ceiling_origin = source;
  if (!Array.isArray(state.ceiling_overrides)) state.ceiling_overrides = [];
  state.ceiling_overrides.push(override);
  saveState(root, state);
  return { ceiling: state.ceiling, overridden: true, source, ceiling_origin: state.ceiling_origin, override };
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
 * Selects the tier a dispatch declaring `costs` (its full capability set) runs at against
 * `ceiling`. `costs` is a single cost string or an ascending, duplicate-free array/list of them.
 * Always allows, and always runs at a tier the unit itself declared:
 *
 *  - some declared member sits at or below the ceiling -> `selected` is the HIGHEST such member.
 *    The ceiling silently picks the richest permitted tier -- this is selection within declared
 *    capability, not a downgrade.
 *  - no declared member fits -> `selected` is the CHEAPEST declared member (`supported[0]`). A
 *    unit whose cheapest declared tier is already above the ceiling has no cheaper mode to fall
 *    back to -- it is intrinsically that expensive, so blocking it would not be a saving, only a
 *    stoppage. It runs at its own declared floor rather than not at all.
 *
 * `supported` always echoes exactly the normalized declared set -- there is no lookup table, no
 * "nearest allowed tier" pulled from outside what the unit itself declared. The result is frozen so
 * a caller can't rewrite it into something that would look like one.
 */
export function decideDispatch(costs, ceiling) {
  const supported = normalizeCostSet(costs, 'declared cost');
  if (!VALID_COSTS.includes(ceiling)) {
    throw new Error(`cost-ceiling: unrecognized ceiling "${ceiling}" (expected one of ${VALID_COSTS.join('|')})`);
  }
  // `ORDER[c] > ORDER[selected]` is redundant given `supported`'s strictly-ascending invariant
  // (normalizeCostSet enforces it) -- each later `c` in the loop is already the higher one. Left
  // in as a documented guard, not a bug: it makes "take the highest permitted member" true by
  // construction even if that invariant were ever relaxed, rather than by iteration order alone.
  let selected = null;
  for (const c of supported) {
    if (ORDER[c] <= ORDER[ceiling] && (selected === null || ORDER[c] > ORDER[selected])) {
      selected = c;
    }
  }
  // Nothing in `supported` fit the ceiling: fall back to the cheapest declared member rather than
  // blocking. It is still a tier the unit itself declared, so the never-degrade rule holds.
  if (selected === null) selected = supported[0];
  return Object.freeze({ action: 'allow', selected, supported, ceiling });
}

/**
 * The only sanctioned way to turn a decideDispatch() result into a model. `decideDispatch` always
 * returns "allow" now, so this guard is unreachable by construction -- kept anyway as the
 * structural closer for the never-degrade rule: nothing can hand this function a decision that
 * wasn't produced by `decideDispatch`'s own selection and expect a model back.
 */
export function modelForDispatch(decision, host, mapping) {
  if (!decision || decision.action !== 'allow') {
    throw new Error(
      `cost-ceiling: modelForDispatch requires an "allow" decision (one of ${ACTIONS.join('|')}), got "${decision?.action}"`
    );
  }
  return resolveModel(decision.selected, host, mapping);
}
