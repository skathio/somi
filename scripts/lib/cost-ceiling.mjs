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
    const state = { ceiling };
    saveState(root, state);
    return { state, bootstrapSource: isConfigured ? 'config' : 'default' };
  }
  const state = JSON.parse(raw);
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`cost-ceiling: ${file} is not a valid state object`);
  }
  state.ceiling = validateCeiling(state.ceiling, `ceiling in ${file}`);
  return { state, bootstrapSource: 'state' };
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
 * @returns {{ceiling: string, overridden: boolean, source: string, override?: object}}
 */
export function resolveCeiling(root, explicitArg) {
  const { state, bootstrapSource } = loadOrInitState(root);
  const isCli = explicitArg !== undefined && explicitArg !== '';
  const envVal = process.env[CEILING_ENV];
  const explicit = isCli ? explicitArg : (envVal === undefined || envVal === '' ? undefined : envVal);
  if (explicit === undefined) {
    return { ceiling: state.ceiling, overridden: false, source: bootstrapSource };
  }
  const source = isCli ? 'cli' : 'env';
  const validated = validateCeiling(explicit, isCli ? '--ceiling' : CEILING_ENV);
  if (validated === state.ceiling) {
    return { ceiling: state.ceiling, overridden: false, source };
  }
  const override = {
    field: 'ceiling',
    from: state.ceiling,
    to: validated,
    source,
    at: nowIso(),
  };
  state.ceiling = validated;
  if (!Array.isArray(state.ceiling_overrides)) state.ceiling_overrides = [];
  state.ceiling_overrides.push(override);
  saveState(root, state);
  return { ceiling: state.ceiling, overridden: true, source, override };
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
