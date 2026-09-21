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

/**
 * Decides what a dispatch declaring `cost` may do against `ceiling`. Exactly three outcomes exist
 * (ACTIONS) and none of them carries a substitute cost: `cost` in the return value is always the
 * same value passed in, on every branch — there is no lookup table, no "nearest allowed tier".
 * `ceiling` IS present on the ask/refuse branches, and is a valid, strictly cheaper tier —
 * modelForDispatch() below, not this function's shape alone, is what keeps that from being read
 * as a substitute. The result is frozen so a caller can't rewrite it into something that would.
 */
export function decideDispatch(cost, ceiling, interactive) {
  if (!VALID_COSTS.includes(cost)) {
    throw new Error(`cost-ceiling: unrecognized cost "${cost}" (expected one of ${VALID_COSTS.join('|')})`);
  }
  if (!VALID_COSTS.includes(ceiling)) {
    throw new Error(`cost-ceiling: unrecognized ceiling "${ceiling}" (expected one of ${VALID_COSTS.join('|')})`);
  }
  if (ORDER[cost] <= ORDER[ceiling]) {
    return Object.freeze({ action: 'allow', cost, ceiling });
  }
  if (interactive) {
    return Object.freeze({
      action: 'ask',
      cost,
      ceiling,
      message: `declared cost "${cost}" is above the session ceiling "${ceiling}" — proceed at "${cost}"?`,
    });
  }
  return Object.freeze({
    action: 'refuse',
    cost,
    ceiling,
    reason: `declared cost "${cost}" exceeds the session ceiling "${ceiling}" and this dispatch is non-interactive`,
  });
}

/**
 * The only sanctioned way to turn a decideDispatch() result into a model: refuses outright unless
 * the decision is "allow", so a caller can never pass `ceiling` -- a valid, strictly cheaper tier
 * on the ask/refuse branches -- to resolveModel() as if it were the cost to dispatch at.
 */
export function modelForDispatch(decision, host, mapping) {
  if (!decision || decision.action !== 'allow') {
    throw new Error(
      `cost-ceiling: modelForDispatch requires an "allow" decision (one of ${ACTIONS.join('|')}), got "${decision?.action}"`
    );
  }
  return resolveModel(decision.cost, host, mapping);
}
