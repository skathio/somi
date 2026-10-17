// cost-defaults.mjs — the default .somi/config.json `cost` block a project with no config gets.
//
// The table is literal data, not read from agents/ at runtime: the code that writes the file runs in
// a consuming project where only the plugin install exists, and agent frontmatter may stop carrying
// `cost:` altogether. tests/scripts/cost-defaults.sh keeps it equal to the highest tier each
// agents/*.md declares today.
//
// Every agent is pinned to the highest tier it declares, so a fresh project keeps the depth each
// agent was built for even though the default ceiling is lower. The front-door `somi` agent is not
// listed: it declares no cost and is exempt from cost resolution (the host binds its model).
// Tier names only; which model a tier means is cost.mapping's job.

import { DEFAULT_CEILING } from './cost-ceiling.mjs';
import { validateCostConfig } from './cost-config.mjs';

export const DEFAULT_CEILING_TIER = DEFAULT_CEILING;

// Null-prototype and frozen: a plain lookup of "constructor" finds nothing, and nothing can edit it.
export const AGENT_DEFAULT_TIERS = Object.freeze(Object.assign(Object.create(null), {
  'architecture-reviewer': 'high',
  atlas: 'high',
  coder: 'medium',
  designer: 'high',
  'discovery-analyst': 'high',
  impact: 'medium',
  incident: 'medium',
  'plan-reviewer': 'high',
  planner: 'medium',
  pr: 'medium',
  'refactor-designer': 'high',
  refactorer: 'medium',
  reviewer: 'high',
  'sdlc-reviewer': 'high',
  'security-reviewer': 'high',
  'test-strategist': 'high',
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
