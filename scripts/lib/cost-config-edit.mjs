// cost-config-edit.mjs — the pure edit step shared by scripts/somi-config.mjs, the cost-lowering
// PreToolUse hook and the tests: parse a key, check a tier, and apply set/unset/init to an
// already-parsed config. No I/O. Only cost.ceiling and cost.agents.<name> can be edited.

import { validateCostConfig, quote } from './cost-config.mjs';
import { VALID_COSTS } from './cost-model.mjs';
import { buildDefaultConfig } from './cost-defaults.mjs';

// A caller mistake (bad key, tier or name), as opposed to a problem with the project's files.
export class EditError extends Error {}

const KEY_RE = /^cost\.(ceiling|agents\.([a-z][a-z0-9-]*))$/;

/** -> {kind:'ceiling'} | {kind:'agent', name}; throws EditError for any other key. */
export function parseKey(key) {
  const m = KEY_RE.exec(key);
  if (!m) throw new EditError(`only cost.ceiling and cost.agents.<name> can be used, not ${quote(key)}`);
  return m[1] === 'ceiling' ? { kind: 'ceiling' } : { kind: 'agent', name: m[2] };
}

export function parseTier(v) {
  if (!VALID_COSTS.includes(v)) throw new EditError(`the tier must be one of ${VALID_COSTS.join('|')}, got ${quote(v)}`);
  return v;
}

/** Throws unless the whole cost block is legal (keys, agent names, tiers, ceiling value). */
export function validateCostBlock(cost) {
  validateCostConfig(cost);
  if (cost && cost.ceiling !== undefined && !VALID_COSTS.includes(cost.ceiling)) {
    throw new Error(`cost-ceiling: cost.ceiling expected one of ${VALID_COSTS.join('|')}, got ${quote(cost.ceiling)}`);
  }
}

/**
 * Applies one edit to `cfg` (a parsed config object, or null for an absent file) IN PLACE where it
 * can, and returns {next, changed}. `action` is set|unset|init. A set or init on an absent file
 * starts from the default config; an unset of an absent file or entry changes nothing. The result is
 * not validated here: callers run validateCostBlock(next.cost) so each can report it its own way.
 */
export function applyEdit(cfg, { action, key, value }) {
  const absent = cfg === null || cfg === undefined;
  if (action === 'init') return absent ? { next: buildDefaultConfig(), changed: true } : { next: cfg, changed: false };
  const k = parseKey(key);
  if (action === 'unset') {
    if (k.kind !== 'agent') throw new EditError('only cost.agents.<name> can be unset');
    if (absent || !(cfg.cost?.agents && Object.hasOwn(cfg.cost.agents, k.name))) return { next: cfg ?? {}, changed: false };
    delete cfg.cost.agents[k.name];
    return { next: cfg, changed: true };
  }
  if (action !== 'set') throw new EditError('the action must be set, unset or init');
  const tier = parseTier(value);
  const next = absent ? buildDefaultConfig() : cfg;
  const before = JSON.stringify(next.cost ?? null);
  if (next.cost === undefined || next.cost === null) next.cost = {};
  if (k.kind === 'ceiling') next.cost.ceiling = tier;
  else {
    if (next.cost.agents === undefined) next.cost.agents = {};
    next.cost.agents[k.name] = tier;
  }
  return { next, changed: absent || JSON.stringify(next.cost) !== before };
}
