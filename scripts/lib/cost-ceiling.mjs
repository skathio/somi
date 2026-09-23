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
export const ACTIONS = Object.freeze(['allow', 'ask', 'refuse']);

const ORDER = Object.freeze(Object.fromEntries(VALID_COSTS.map((c, i) => [c, i])));

export function ceilingStatePath(root) {
  return path.join(root, '.somi', 'somi-state', 'ceiling.json');
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function readConfig(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, '.somi', 'config.json'), 'utf8'));
  } catch {
    return {}; // missing or unparsable config: best-effort, matches the existing config readers
  }
}

const COST_CONFIG_KEYS = new Set(['ceiling', 'mapping']);

// A `cost` that isn't an object, has an unrecognized key (a typo), or a `ceiling` misplaced at
// the top level all die loudly here instead of silently resolving to "not configured".
function readCostConfig(root) {
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
function loadOrInitState(root) {
  const file = ceilingStatePath(root);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const configured = readCostConfig(root).ceiling;
    const ceiling = configured === undefined || configured === null || configured === ''
      ? DEFAULT_CEILING
      : validateCeiling(configured, 'cost.ceiling in .somi/config.json');
    const state = { ceiling };
    saveState(root, state);
    return state;
  }
  const state = JSON.parse(raw);
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`cost-ceiling: ${file} is not a valid state object`);
  }
  state.ceiling = validateCeiling(state.ceiling, `ceiling in ${file}`);
  return state;
}

/**
 * Re-resolves the session ceiling for one dispatch. `explicitArg` is a value the caller already
 * extracted THIS invocation (e.g. a parsed CLI flag) — distinct from SOMI_COST_CEILING, read here.
 * Precedence for what can MOVE a ceiling already in force: explicitArg > env var; neither present
 * means the ceiling on disk stands, full stop — `.somi/config.json` is never re-read after the
 * state file first exists.
 * @returns {{ceiling: string, overridden: boolean, override?: object}}
 */
export function resolveCeiling(root, explicitArg) {
  const state = loadOrInitState(root);
  const isCli = explicitArg !== undefined && explicitArg !== '';
  const envVal = process.env[CEILING_ENV];
  const explicit = isCli ? explicitArg : (envVal === undefined || envVal === '' ? undefined : envVal);
  if (explicit === undefined) {
    return { ceiling: state.ceiling, overridden: false };
  }
  const validated = validateCeiling(explicit, isCli ? '--cost-ceiling' : CEILING_ENV);
  if (validated === state.ceiling) {
    return { ceiling: state.ceiling, overridden: false };
  }
  const override = {
    field: 'ceiling',
    from: state.ceiling,
    to: validated,
    source: isCli ? 'cli' : 'env',
    at: nowIso(),
  };
  state.ceiling = validated;
  if (!Array.isArray(state.ceiling_overrides)) state.ceiling_overrides = [];
  state.ceiling_overrides.push(override);
  saveState(root, state);
  return { ceiling: state.ceiling, overridden: true, override };
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
 * Decides what a dispatch declaring `costs` (its full capability set) may do against `ceiling`.
 * `costs` is a single cost string or an ascending, duplicate-free array/list of them. Exactly three
 * outcomes exist (ACTIONS):
 *
 *  - some declared member sits at or below the ceiling -> "allow", carrying the HIGHEST such
 *    member as `selected`. The ceiling silently picks the richest permitted tier -- this is
 *    selection within declared capability, not a downgrade, so it never prompts.
 *  - no declared member fits -> "ask" (interactive) or "refuse" (non-interactive). Neither branch
 *    carries a `selected` tier, because none was chosen: the unit never runs at a tier absent from
 *    its own declaration, so there is nothing to substitute.
 *
 * `supported` on every branch always echoes exactly the normalized declared set -- there is no
 * lookup table, no "nearest allowed tier" pulled from outside what the unit itself declared. The
 * result is frozen so a caller can't rewrite it into something that would look like one.
 */
export function decideDispatch(costs, ceiling, interactive) {
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
  if (selected !== null) {
    return Object.freeze({ action: 'allow', selected, supported, ceiling });
  }
  // The cheapest declared member is above the ceiling by construction (nothing in `supported`
  // fit, or `selected` would be non-null above) -- exactly the tier a "yes" to `ask` would need
  // to run at. Exposed as `proposed` on both branches, not just interpolated into prose, so a
  // caller acting on approval doesn't have to parse `message`/`reason` back out of English.
  const cheapest = supported[0];
  if (interactive) {
    return Object.freeze({
      action: 'ask',
      supported,
      ceiling,
      proposed: cheapest,
      message: `declared cost set [${supported.join(', ')}] has no member at or below the session ceiling "${ceiling}" — proceed at "${cheapest}" (its cheapest supported tier)?`,
    });
  }
  return Object.freeze({
    action: 'refuse',
    supported,
    ceiling,
    proposed: cheapest,
    reason: `declared cost set [${supported.join(', ')}] has no member at or below the session ceiling "${ceiling}" and this dispatch is non-interactive`,
  });
}

/**
 * The only sanctioned way to turn a decideDispatch() result into a model: refuses outright unless
 * the decision is "allow", so a caller can never pass `supported` or `ceiling` -- present on the
 * ask/refuse branches, and never a tier that was actually chosen -- to resolveModel() as if a
 * selection had been made.
 */
export function modelForDispatch(decision, host, mapping) {
  if (!decision || decision.action !== 'allow') {
    throw new Error(
      `cost-ceiling: modelForDispatch requires an "allow" decision (one of ${ACTIONS.join('|')}), got "${decision?.action}"`
    );
  }
  return resolveModel(decision.selected, host, mapping);
}
