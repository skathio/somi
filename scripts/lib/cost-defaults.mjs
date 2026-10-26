// cost-defaults.mjs — the default .somi/config.json `cost` block a project with no config gets.
//
// The table is the one source of each agent's default tier (agent files carry no tier of their own).
// It is literal data, not read from agents/ at runtime: the code that writes the file runs in a
// consuming project where only the plugin install exists. tests/scripts/cost-defaults.sh keeps its
// keys equal to agents/*.md minus the front-door `somi` agent, which is exempt from cost resolution
// (the host binds its model).
// Tier names only; which model a tier means is cost.mapping's job.

import { DEFAULT_CEILING } from './cost-ceiling.mjs';
import { validateCostConfig } from './cost-config.mjs';

export const DEFAULT_CEILING_TIER = DEFAULT_CEILING;

// Null-prototype and frozen: a plain lookup of "constructor" finds nothing, and nothing can edit it.
export const AGENT_DEFAULT_TIERS = Object.freeze(Object.assign(Object.create(null), {
  'somi-architecture-reviewer': 'high',
  'somi-atlas': 'high',
  'somi-coder': 'medium',
  'somi-designer': 'high',
  'somi-discovery-analyst': 'high',
  'somi-impact': 'medium',
  'somi-incident': 'medium',
  'somi-plan-reviewer': 'high',
  'somi-planner': 'medium',
  'somi-pr': 'medium',
  'somi-refactor-designer': 'high',
  'somi-refactorer': 'medium',
  'somi-reviewer': 'high',
  'somi-sdlc-reviewer': 'high',
  'somi-security-reviewer': 'high',
  'somi-test-strategist': 'high',
}));

/**
 * The exact object a fresh .somi/config.json holds: `{cost: {ceiling, agents}}`, agents sorted by
 * name so the bytes are stable. `table` is overridable for tests. Throws if the shared validator
 * rejects it.
 */
export function buildDefaultConfig(table = AGENT_DEFAULT_TIERS) {
  const agents = {};
  for (const name of Object.keys(table).sort()) agents[name] = table[name];
  const cost = { ceiling: DEFAULT_CEILING_TIER, agents };
  validateCostConfig(cost);
  return { cost };
}

/** The file text: JSON, 2-space indent, trailing newline. The one serialization every writer uses. */
export function serializeDefaultConfig(table = AGENT_DEFAULT_TIERS) {
  return `${JSON.stringify(buildDefaultConfig(table), null, 2)}\n`;
}
