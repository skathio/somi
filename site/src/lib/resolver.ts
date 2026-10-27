// A simplified browser copy of SoMi's dispatch resolution (scripts/lib/dispatch-resolver.mjs), for the demo
// on the cost section. The tier rules are the real ones; the agent table and Claude Code's model map come
// from the repo through generated/facts.json.

export type Tier = 'low' | 'medium' | 'high';
export type Host = 'claude-code' | 'copilot-cli' | 'copilot-cli-mapped';

export const TIERS: readonly Tier[] = ['low', 'medium', 'high'];
const RANK: Record<Tier, number> = { low: 0, medium: 1, high: 2 };

export const below = (a: Tier, b: Tier): boolean => RANK[a] < RANK[b];

export interface CostState {
  ceiling: Tier;
  /** `cost.agents` entries; an agent without one follows the ceiling. */
  pins: Partial<Record<string, Tier>>;
}

export interface Resolution {
  agent: string;
  agent_type: string;
  declared: Tier;
  tier: Tier;
  tier_source: 'override' | 'ceiling';
  degraded: boolean;
  ceiling: Tier;
  model?: string | null;
  model_candidates?: string[];
  enforced: boolean;
  reason?: string;
}

/** The tier an agent runs at: its `cost.agents` entry, which wins even above the ceiling, else the ceiling. */
export function effectiveTier(state: CostState, agent: string): Tier {
  return state.pins[agent] ?? state.ceiling;
}

export function resolve(
  state: CostState,
  agent: string,
  defaults: Record<string, Tier>,
  host: Host,
  claudeCodeModels: Record<Tier, string>,
): Resolution {
  const declared = defaults[agent];
  if (!declared) throw new Error(`unknown agent: ${agent}`);
  const tier = effectiveTier(state, agent);
  const base = {
    agent,
    agent_type: `somi:${agent}`,
    declared,
    tier,
    tier_source: state.pins[agent] ? ('override' as const) : ('ceiling' as const),
    degraded: below(tier, declared),
    ceiling: state.ceiling,
  };
  switch (host) {
    case 'claude-code':
      return { ...base, model: claudeCodeModels[tier], enforced: true };
    case 'copilot-cli-mapped':
      return { ...base, model_candidates: [`<your ${tier} ids, in order>`], enforced: true };
    case 'copilot-cli':
      return { ...base, model: null, enforced: false, reason: 'no model mapping for host copilot-cli' };
  }
}

/** The line an agent's briefing carries: it claims an applied tier only when a model was enforced. */
export function costLine(r: Resolution): string {
  return r.enforced ? `dispatched at cost: ${r.tier}` : `requested cost: ${r.tier} (not enforced: no mapped model)`;
}

/**
 * What a change lowers, if anything: the ceiling, or any agent's effective tier (the security reviewer
 * falling below `high` is one such agent). SoMi holds every such change for the user's confirmation.
 * -> a short description of what is lowered, or null.
 */
export function lowered(before: CostState, after: CostState, agents: string[]): string | null {
  if (below(after.ceiling, before.ceiling)) return 'the ceiling';
  const hit = agents.filter((a) => below(effectiveTier(after, a), effectiveTier(before, a)));
  if (hit.length === 0) return null;
  return hit.length === 1 ? hit[0] : `${hit.length} agents`;
}
