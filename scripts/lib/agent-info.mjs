// agent-info.mjs — the read-only somi_agent_info lookup: the agent catalog, or one identifier (a
// canonical name or a registered alias) normalised through agent-registry.mjs and resolved through the
// shared dispatch resolver with persist:false, so a lookup reports what a dispatch would get right now
// and writes nothing (no ceiling argument is accepted, and an env ceiling is never remembered).
//
// Pure apart from the resolver's reads: the caller supplies the project root lookup (the MCP server's
// can be a roots/list round trip) and the install root, and turns {ok, ...} into its own surface.

import { buildRegistry, normalize, agentTypeFor, catalog, ORCHESTRATOR } from './agent-registry.mjs';
import { resolveDispatch, EXIT_USAGE, EXIT_UNKNOWN_AGENT } from './dispatch-resolver.mjs';

// Built once: an alias collision fails at import, before any lookup answers.
const REGISTRY = buildRegistry();
const HOST_RE = /^[a-z][a-z0-9-]{0,31}$/;

export const AGENT_INFO_TOOL = {
  name: 'somi_agent_info',
  description:
    'Read-only agent registry and dispatch lookup. Without `agent`: the catalog of every canonical ' +
    'SoMi agent with the aliases hosts actually register for it and its default tier. With `agent` ' +
    '(a canonical name such as "somi-coder" or a registered alias such as "somi:somi-coder"): the ' +
    'canonical agent, the alias that matched, `agent_type` (the id to pass as the host subagent ' +
    'type), and the tier and model it would run at right now on `host` — from the same resolver as ' +
    'somi_resolve, but nothing is written: no ceiling is set or remembered. Failures: 64 invalid ' +
    'identifier or arguments, 65 unknown agent or alias (never routed to another agent), 67 ' +
    'project environment failure (as somi_resolve).',
  inputSchema: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'canonical name or registered alias; omit for the catalog' },
      host: { type: 'string', description: '"claude-code" or "copilot"; defaults to "claude-code"' },
      project_dir: { type: 'string', description: 'absolute path of the consuming project, as for somi_resolve (lookup only)' },
    },
  },
};

const fail = (code, message) => ({ ok: false, code, message });

/**
 * @param {{agent?: unknown, host?: unknown}} args
 * @param {{resolveRoot: () => Promise<{ok: boolean, root?: string, code?: number, message?: string}>, installRoot: string}} env
 * @returns {Promise<{ok: true, result: object} | {ok: false, code: number, message: string}>}
 */
export async function agentInfo(args, { resolveRoot, installRoot }) {
  const host = args?.host;
  if (host !== undefined && (typeof host !== 'string' || !HOST_RE.test(host))) {
    return fail(EXIT_USAGE, `host must be a lowercase host name, got ${JSON.stringify(host)}`);
  }
  if (args?.agent === undefined) return { ok: true, result: { agents: catalog(REGISTRY) } };
  const n = normalize(REGISTRY, args.agent);
  if (!n.ok) return fail(n.reason === 'invalid' ? EXIT_USAGE : EXIT_UNKNOWN_AGENT, n.message);
  const HOST = host || 'claude-code';
  const identity = {
    requested_as: args.agent,
    canonical_name: n.canonical,
    matched_alias: n.matched_alias,
    aliases: REGISTRY.aliasesOf.get(n.canonical).filter((a) => a !== n.matched_alias),
    agent_type: agentTypeFor(REGISTRY, n.canonical, HOST),
    host: HOST,
  };
  if (n.canonical === ORCHESTRATOR) {
    return { ok: true, result: { ...identity, role: 'orchestrator', dispatch: null, reason: 'the front door is selected by the user, never dispatched; the host binds its model' } };
  }
  const root = await resolveRoot();
  if (!root.ok) return fail(root.code, root.message);
  const outcome = resolveDispatch({ agent: n.canonical, host: HOST, projectRoot: root.root, installRoot, persist: false });
  if (!outcome.ok) return outcome;
  const r = outcome.result;
  return {
    ok: true,
    result: {
      ...identity,
      role: 'specialist',
      session_ceiling: { value: r.ceiling, source: r.ceiling_source, origin: r.ceiling_origin },
      default_tier: r.declared[0],
      dispatch_tier: r.tier,
      tier_source: r.tier_source,
      degraded: r.degraded,
      model: r.model,
      enforced: r.enforced,
      ...(r.reason ? { reason: r.reason } : {}),
    },
  };
}
