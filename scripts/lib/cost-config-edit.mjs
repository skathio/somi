// cost-config-edit.mjs — the pure edit step shared by scripts/somi-config.mjs, the cost-lowering
// PreToolUse hook and the tests: parse a key, check a tier, and apply set/unset/init to an
// already-parsed config. No I/O. Only cost.ceiling and cost.agents.<name> can be edited.

import { validateCostConfig, quote } from './cost-config.mjs';
import { VALID_COSTS, MODEL_ID_RE, MAX_MODEL_CANDIDATES, mergeHostMapping, resolveModelCandidates } from './cost-model.mjs';
import { buildDefaultConfig } from './cost-defaults.mjs';

// A caller mistake (bad key, tier or name), as opposed to a problem with the project's files.
export class EditError extends Error {}

const KEY_RE = /^cost\.(ceiling|agents\.([a-z][a-z0-9-]*)|mapping\.([a-z][a-z0-9-]{0,31})(?:\.(low|medium|high))?)$/;

/**
 * -> {kind:'ceiling'} | {kind:'agent', name} | {kind:'mapping', host, tier?}; throws EditError for any
 * other key. `cost.mapping.<host>.<tier>` is set; `cost.mapping.<host>` (the whole host map) is unset.
 */
export function parseKey(key) {
  const m = KEY_RE.exec(key);
  if (!m) throw new EditError(`only cost.ceiling, cost.agents.<name> and cost.mapping.<host>[.<tier>] can be used, not ${quote(key)}`);
  if (m[1] === 'ceiling') return { kind: 'ceiling' };
  if (m[2] !== undefined) return { kind: 'agent', name: m[2] };
  return { kind: 'mapping', host: m[3], tier: m[4] };
}

/** A model value: one id, or a comma-separated preference list (#35) -> a string or an array. */
export function parseModels(v) {
  const list = typeof v === 'string' ? v.split(',').map((x) => x.trim()) : [];
  if (list.length === 0 || list.length > MAX_MODEL_CANDIDATES || list.some((x) => !MODEL_ID_RE.test(x)) || new Set(list).size !== list.length) {
    throw new EditError(`the value must be a model id or up to ${MAX_MODEL_CANDIDATES} distinct comma-separated ids, got ${quote(v)}`);
  }
  return list.length === 1 ? list[0] : list;
}

/** The tiers a named host's map still lacks (a host in cost.mapping replaces its whole tier map). */
export function missingMappingTiers(cost, host) {
  const tiers = cost?.mapping?.[host];
  return tiers ? VALID_COSTS.filter((t) => !Object.hasOwn(tiers, t)) : [];
}

export function parseTier(v) {
  if (!VALID_COSTS.includes(v)) throw new EditError(`the tier must be one of ${VALID_COSTS.join('|')}, got ${quote(v)}`);
  return v;
}

/** Throws unless the whole cost block is legal (keys, agent names, tiers, ceiling value). */
export function validateCostBlock(cost) {
  validateCostConfig(cost);
  if (cost && cost.mapping !== undefined) {
    const merged = mergeHostMapping({}, cost.mapping);
    for (const host of Object.keys(merged)) for (const tier of Object.keys(merged[host])) resolveModelCandidates(tier, host, merged);
  }
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
    if (k.kind === 'mapping' && k.tier === undefined) {
      if (absent || !(cfg.cost?.mapping && Object.hasOwn(cfg.cost.mapping, k.host))) return { next: cfg ?? {}, changed: false };
      delete cfg.cost.mapping[k.host];
      if (Object.keys(cfg.cost.mapping).length === 0) delete cfg.cost.mapping;
      return { next: cfg, changed: true };
    }
    if (k.kind !== 'agent') throw new EditError('only cost.agents.<name> and cost.mapping.<host> can be unset');
    if (absent || !(cfg.cost?.agents && Object.hasOwn(cfg.cost.agents, k.name))) return { next: cfg ?? {}, changed: false };
    delete cfg.cost.agents[k.name];
    return { next: cfg, changed: true };
  }
  if (action !== 'set') throw new EditError('the action must be set, unset or init');
  if (k.kind === 'mapping') {
    if (k.tier === undefined) throw new EditError('set one tier at a time: cost.mapping.<host>.<low|medium|high>');
    const models = parseModels(value);
    const base = absent ? buildDefaultConfig() : cfg;
    const before = JSON.stringify(base.cost ?? null);
    if (base.cost === undefined || base.cost === null) base.cost = {};
    if (base.cost.mapping === undefined) base.cost.mapping = {};
    if (base.cost.mapping[k.host] === undefined) base.cost.mapping[k.host] = {};
    base.cost.mapping[k.host][k.tier] = models;
    return { next: base, changed: absent || JSON.stringify(base.cost) !== before };
  }
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
