// cost-lowering.mjs — does moving from one config to another LOWER any agent's tier?
//
// Pure. Compares EFFECTIVE tiers (the agent's cost.agents entry, else the ceiling: the resolver's own
// rule, via decideDispatch) for every agent in the default table and any named in either config. It
// answers one question for the PreToolUse hook and the CLI's --refuse-lowering: does this change need
// the user? Reasons are fixed strings; nothing from either config is ever echoed.
//
// A change lowers when any of these holds:
//   - security-reviewer would run below high (flagged even if unchanged from before, so an explicit low
//     pin is always flagged; an identical before and after is a no-op and never lowers)
//   - the ceiling is lower than before
//   - an agent's effective tier is lower than before; when that is a removed pin above the ceiling
//     the reason says so
//   - the new config is not an object, or its cost block is not valid
// Whether a state file appears later cannot change a verdict: a config that has NO cost.ceiling after the
// change is judged against the worst case, so deleting cost.ceiling (or unpinning an agent in a config
// without one) is a lowering unless the removed value was already `low`. Otherwise a model could delete the
// ceiling first and plant a persisted low ceiling afterwards.
// The ceiling an absent cost.ceiling falls back to is the resolver's: a ceiling an earlier --ceiling or
// env call persisted (origin cli/env), else the default. `root` (the project) is needed to read that
// state, read-only; it is applied on BOTH sides of the comparison, so deleting cost.ceiling is judged by
// the value that takes over. SOMI_COST_CEILING of the session is not known here and is not considered.
// Raises and no-ops never lower. Both arguments are parsed config objects ({} or null for an absent
// file); `after` may also be anything unparsed (null, a string, an array), which counts as invalid.

import { decideDispatch, DEFAULT_CEILING, loadState } from './cost-ceiling.mjs';
import { VALID_COSTS } from './cost-model.mjs';
import { AGENT_DEFAULT_TIERS } from './cost-defaults.mjs';
import { validateCostBlock } from './cost-config-edit.mjs';

export const REASONS = Object.freeze({
  security: 'security-reviewer would run below high',
  ceiling: 'the ceiling would be lowered',
  agent: 'an agent tier would be lowered',
  pin: 'a pin above the ceiling would be removed',
  invalid: 'the new config is not valid',
});

const rank = (t) => VALID_COSTS.indexOf(t);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The persisted ceiling that would take over when cost.ceiling is absent, or undefined.
function stateCeiling(root) {
  if (!root) return undefined;
  try {
    const st = loadState(root);
    return st && ['cli', 'env'].includes(st.ceiling_origin) ? st.ceiling : undefined;
  } catch {
    return undefined; // an unreadable state file is the resolver's error to report, not a reason here
  }
}

// Tolerant on purpose: a bad value in `before` must not make the comparison throw.
function view(cfg, fallback) {
  const cost = isObj(cfg) && isObj(cfg.cost) ? cfg.cost : {};
  const ceiling = VALID_COSTS.includes(cost.ceiling) ? cost.ceiling : fallback;
  const agents = isObj(cost.agents) ? cost.agents : {};
  const pin = (name) => (Object.hasOwn(agents, name) && VALID_COSTS.includes(agents[name]) ? agents[name] : undefined);
  const tier = (name) => decideDispatch(AGENT_DEFAULT_TIERS[name] ?? ceiling, ceiling, pin(name)).selected;
  return { ceiling, pin, tier, names: Object.keys(agents), json: JSON.stringify(cost) };
}

/** @returns {{lowers: boolean, reasons: string[]}}; `root` is the project directory (for the persisted ceiling). */
export function lowers(before, after, root) {
  if (!isObj(after)) return { lowers: true, reasons: [REASONS.invalid] };
  try { validateCostBlock(after.cost); } catch { return { lowers: true, reasons: [REASONS.invalid] }; }
  const fallback = stateCeiling(root) ?? DEFAULT_CEILING;
  const b = view(before, fallback);
  const a = view(after, fallback);
  const ceilingGone = isObj(before?.cost) && VALID_COSTS.includes(before.cost.ceiling) && !(isObj(after.cost) && VALID_COSTS.includes(after.cost.ceiling));
  const worst = (name) => decideDispatch(AGENT_DEFAULT_TIERS[name] ?? 'low', 'low', undefined).selected;
  if (a.json === b.json) return { lowers: false, reasons: [] };
  const reasons = new Set();
  if (rank(a.tier('security-reviewer')) < rank('high')) reasons.add(REASONS.security);
  if (rank(a.ceiling) < rank(b.ceiling) || (ceilingGone && rank(b.ceiling) > rank('low'))) reasons.add(REASONS.ceiling);
  const noCeiling = !(isObj(after.cost) && VALID_COSTS.includes(after.cost.ceiling));
  for (const name of new Set([...Object.keys(AGENT_DEFAULT_TIERS), ...b.names, ...a.names])) {
    const removedPin = b.pin(name) !== undefined && a.pin(name) === undefined;
    const aTier = removedPin && noCeiling ? worst(name) : a.tier(name);
    if (rank(aTier) >= rank(b.tier(name))) continue;
    reasons.add(removedPin ? REASONS.pin : REASONS.agent);
  }
  return { lowers: reasons.size > 0, reasons: [...reasons] };
}
