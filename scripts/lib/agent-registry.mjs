// agent-registry.mjs — the one source of SoMi agent identity: canonical names, the aliases hosts
// actually register for them, and the normalisation from either one to the canonical name.
//
// Canonical names are the default tier table's keys (every specialist, `somi-` prefixed) plus the
// front-door orchestrator `somi`, which is exempt from cost resolution. tests/scripts/agent-registry.sh
// keeps this set equal to agents/*.md.
//
// Aliases are never guessed. A host that registers SoMi's plugin agents under ids of its own is
// declared in HOST_REGISTRATIONS with the rule it applies; an alias exists only for a host listed
// there. Both shipped hosts namespace a plugin agent as `<plugin>:<file stem>`:
//   - copilot: the loader in Copilot CLI 1.0.70 (configLoaderParsePluginAgentFile in its runtime.node),
//     run on this repo, returns ids such as `somi:somi-planner`; its task tool accepts any registered
//     id and rejects a bare stem with `Unknown agent_type`.
//   - claude-code: the Task tool lists plugin agents as `somi:<file stem>`.
// So today every agent has exactly one alias, `somi:<canonical>`, registered on both hosts. The
// pre-4.0.0 bare names (`coder`) are deliberately NOT aliases: they are unknown, with a derived hint.

import { AGENT_DEFAULT_TIERS } from './cost-defaults.mjs';

export const PLUGIN_NAME = 'somi';
export const ORCHESTRATOR = 'somi';

// host -> the id that host's subagent tool takes for a plugin agent's canonical name.
export const HOST_REGISTRATIONS = Object.freeze({
  'claude-code': (canonical) => `${PLUGIN_NAME}:${canonical}`,
  copilot: (canonical) => `${PLUGIN_NAME}:${canonical}`,
});

// An identifier as a caller may supply it: a canonical name, or `<plugin>:<name>`. Checked before
// any lookup, so nothing downstream ever sees an unvalidated string.
export const IDENTIFIER_RE = /^[a-z0-9][a-z0-9-]{0,63}(?::[a-z0-9][a-z0-9-]{0,63})?$/;

export class RegistryError extends Error {}

/**
 * Builds the registry from a tier table and host registrations (both overridable for tests).
 * Throws RegistryError when one alias would map to two agents or shadow a canonical name.
 */
export function buildRegistry(table = AGENT_DEFAULT_TIERS, registrations = HOST_REGISTRATIONS) {
  const specialists = Object.keys(table).sort();
  const agents = [...specialists, ORCHESTRATOR];
  const canonical = new Set(agents);
  const aliasOwner = new Map();
  const aliasesOf = new Map(agents.map((n) => [n, []]));
  const agentTypes = new Map(agents.map((n) => [n, {}]));
  for (const host of Object.keys(registrations).sort()) {
    for (const name of agents) {
      const alias = registrations[host](name);
      agentTypes.get(name)[host] = alias;
      if (alias === name) continue;
      if (canonical.has(alias)) throw new RegistryError(`alias "${alias}" (host ${host}) shadows the canonical agent "${alias}"`);
      const owner = aliasOwner.get(alias);
      if (owner !== undefined && owner !== name) throw new RegistryError(`alias "${alias}" maps to both "${owner}" and "${name}"`);
      if (owner === undefined) {
        aliasOwner.set(alias, name);
        aliasesOf.get(name).push(alias);
      }
    }
  }
  return { specialists, canonical, aliasOwner, aliasesOf, agentTypes, table };
}

/**
 * -> {ok: true, canonical, matched_alias} | {ok: false, reason: 'invalid'|'unknown', message}.
 * An identifier that is a pre-4.0.0 bare name gets a hint, derived rather than stored.
 */
export function normalize(registry, identifier) {
  if (typeof identifier !== 'string' || !IDENTIFIER_RE.test(identifier)) {
    return { ok: false, reason: 'invalid', message: `invalid agent identifier ${JSON.stringify(identifier)} (expected ${IDENTIFIER_RE})` };
  }
  if (registry.canonical.has(identifier)) return { ok: true, canonical: identifier, matched_alias: null };
  const owner = registry.aliasOwner.get(identifier);
  if (owner !== undefined) return { ok: true, canonical: owner, matched_alias: identifier };
  const renamed = `somi-${identifier}`;
  const hint = registry.canonical.has(renamed) ? ` (renamed in 4.0.0: use "${renamed}")` : '';
  return { ok: false, reason: 'unknown', message: `unknown agent "${identifier}"${hint}` };
}

/** The id `host`'s subagent tool takes for `canonical`, or null when the host registers none. */
export function agentTypeFor(registry, canonical, host) {
  return registry.agentTypes.get(canonical)?.[host] ?? null;
}

/** The catalog: one entry per agent, specialists first, in name order. */
export function catalog(registry) {
  return [...registry.specialists, ORCHESTRATOR].map((name) => ({
    canonical_name: name,
    role: name === ORCHESTRATOR ? 'orchestrator' : 'specialist',
    aliases: [...registry.aliasesOf.get(name)],
    default_tier: registry.table[name] ?? null,
  }));
}
