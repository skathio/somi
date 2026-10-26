// cost-config.mjs — the one validator for the `cost.*` block of .somi/config.json.
//
// The block is committed, cloned input (untrusted), so every consumer must agree on which keys
// and values are legal; keeping that decision here stops readers from drifting apart. Errors keep
// the `cost-ceiling:` prefix so existing callers' config-problem mapping is unchanged.

import { VALID_COSTS } from './cost-model.mjs';

export const COST_CONFIG_KEYS = Object.freeze(['ceiling', 'mapping', 'agents']);

// The one agent-name pattern; dispatch-resolver.mjs re-exports it (that module imports this one, so
// the dependency runs one way).
export const AGENT_NAME_RE = /^[a-z][a-z0-9-]*$/;

// "constructor" and "prototype" satisfy AGENT_NAME_RE, so the name pattern alone does not keep them
// out of a map that later code may index with a plain lookup.
const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

const where = 'cost in .somi/config.json';

// Committed config reaches the model's context through these messages: quote every echoed value and
// bound its length so a hostile key cannot inject lines or escape sequences.
export const quote = (v) => {
  const q = JSON.stringify(v) ?? String(v);
  return q.length > 80 ? `${q.slice(0, 80)}...` : q;
};

// -> a frozen null-prototype copy, so a plain lookup of a missing name ("constructor") finds nothing.
function validateAgents(agents) {
  if (agents === null || typeof agents !== 'object' || Array.isArray(agents)) {
    throw new Error(`cost-ceiling: cost.agents in .somi/config.json expected an object, got ${quote(agents)}`);
  }
  for (const [name, tier] of Object.entries(agents)) {
    if (FORBIDDEN_KEYS.includes(name)) {
      throw new Error(`cost-ceiling: cost.agents in .somi/config.json has a forbidden agent name ${quote(name)}`);
    }
    if (!AGENT_NAME_RE.test(name)) {
      throw new Error(`cost-ceiling: cost.agents in .somi/config.json has an invalid agent name ${quote(name)} (expected ${AGENT_NAME_RE})`);
    }
    if (!VALID_COSTS.includes(tier)) {
      throw new Error(`cost-ceiling: cost.agents.${name} expected one of ${VALID_COSTS.join('|')}, got ${quote(tier)}`);
    }
  }
  return Object.freeze(Object.assign(Object.create(null), agents));
}

/**
 * Validates a parsed `cost` value and returns it (with `agents` as a frozen null-prototype map). `undefined`/`null` mean unconfigured.
 * `ceiling` and `mapping` values are checked where they are used (validateCeiling, resolveModel);
 * this decides only which keys are legal and that `agents` is a name-to-tier map.
 */
export function validateCostConfig(cost) {
  if (cost === undefined || cost === null) return {};
  if (typeof cost !== 'object' || Array.isArray(cost)) {
    throw new Error(`cost-ceiling: ${where} expected an object, got ${quote(cost)}`);
  }
  for (const key of Object.keys(cost)) {
    if (!COST_CONFIG_KEYS.includes(key)) {
      throw new Error(`cost-ceiling: ${where} has an unrecognized key ${quote(key)}`);
    }
  }
  if (cost.agents === undefined) return cost;
  return { ...cost, agents: validateAgents(cost.agents) };
}
