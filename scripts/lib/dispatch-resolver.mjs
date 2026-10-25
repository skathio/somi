// dispatch-resolver.mjs — the resolve logic shared by scripts/somi-dispatch.mjs (the CLI) and
// scripts/somi-mcp.mjs (the MCP server): for a given agent, right now, which tier and model
// should run it? Factored out so the two surfaces share one validation order and one set of
// error codes/messages rather than each re-deriving the composition and risking drift.
//
// Pure function over explicit inputs: no argv parsing, no process.exit, no stdout/stderr writes.
// Each caller turns the returned {ok, ...} shape into its own surface — the CLI: exit code +
// stdout JSON, or a stderr message; the MCP server: a tool result. Composition (never inline the
// pieces yourself; this is the one sanctioned call site for it):
//   resolveCeiling(projectRoot, ceiling) -> decideDispatch([default tier], ceiling, cost.agents[agent])
//     -> modelForDispatch(decision, host, mergeHostMapping(HOST_MODELS, cost.mapping))
//
// `cost.mapping`, `cost.agents` and `cost.ceiling` are all read from the project's
// .somi/config.json on EVERY call, so a mid-session config fix takes effect on the very next
// dispatch (see cost-ceiling.mjs's header for the ceiling's precedence).
//
// `agent` is validated against a strict allowlist before any path is built — it may come from a
// prompt carrying untrusted text (and, via the MCP server, from a model-supplied tool argument).
//
// Codes both surfaces reuse verbatim (see each caller for how it turns these into its own shape):
//   64  usage error (bad/missing arguments, including an unrecognized ceiling/env-ceiling value) —
//       `validateDispatchArgs` below is the ONE place both surfaces run this family of checks, so
//       the same bad input produces the same code through either surface, checked before either
//       surface's own project-root lookup (the MCP server's own can be a 2s `roots/list` round trip)
//   65  unknown agent (no agents/<name>.md at the install root)
//   66  no tier source (the exempt `somi` agent, or an agent file with no default-tier-table entry) — OR the
//       merged mapping's own resolution for the selected tier failing WHEN the project's own
//       cost.mapping never named that host at all (a bug in the shipped HOST_MODELS table, not a
//       broken project file)
//   67  project environment/config failure (corrupt .somi/somi-state/ceiling.json; an
//       unparsable/malformed .somi/config.json; a structurally invalid cost.mapping) — distinct
//       from 64 because the problem is the project's own persisted files, not this call's
//       arguments — ALSO when the mapping fails for a host the project's mapping DID name (a
//       partial override of a shipped host replaces its whole tier map, not per-tier) — ALSO the
//       code scripts/lib/mcp-project-root.mjs returns for "no project root could be established":
//       the MCP server's own environment failing to add up to a usable answer, same family.
// A guessed model is never returned on any error path — only the ok:true result carries one.

import fs from 'node:fs';
import path from 'node:path';
import { resolveCeiling, decideDispatch, modelForDispatch, readCostConfig, CEILING_ENV } from './cost-ceiling.mjs';
import { AGENT_NAME_RE } from './cost-config.mjs';
import { HOST_MODELS, mergeHostMapping, VALID_COSTS } from './cost-model.mjs';
import { AGENT_DEFAULT_TIERS } from './cost-defaults.mjs';
import { buildRegistry, agentTypeFor } from './agent-registry.mjs';

// Built once: an alias collision fails the import, so no surface can start on an ambiguous registry.
const REGISTRY = buildRegistry();

export { AGENT_NAME_RE };

export const EXIT_USAGE = 64;
export const EXIT_UNKNOWN_AGENT = 65;
export const EXIT_MALFORMED = 66;
export const EXIT_PROJECT_ENV = 67;

function err(code, message) {
  return { ok: false, code, message };
}

// The ONE validation order both surfaces run, over the SAME three fields, producing the SAME code
// for the SAME bad input. scripts/somi-dispatch.mjs and scripts/somi-mcp.mjs each call this
// directly before either does its own project-root lookup (the MCP server's can be a 2s
// `roots/list` round trip); `resolveDispatch` below also calls it first thing, so a direct caller
// of that alone still gets the same checks before any disk I/O.
//
// `undefined` means "not given" for `host`/`ceiling` (the CLI's own sentinel — requireValue()
// already dies on an explicitly empty flag before assignment, so it never passes `''` here). A
// DEFINED-but-wrong-shaped value (an empty string on purpose, an array, an object, a number) is a
// caller mistake, not an omission, and must fail the same way — silently coercing it to "not
// given", as an earlier shape of the MCP surface did, is the bug this function closes.
//
// `agent` has no "not given" reading — it is REQUIRED, so `undefined` fails like any non-string.
export function validateDispatchArgs({ agent, host, ceiling } = {}) {
  // `JSON.stringify`, not a bare template-literal interpolation: an object-shaped `agent` (e.g.
  // `{toString: null}`, reachable as an MCP tool argument) throws INSIDE `${agent}` instead of
  // producing a string, surfacing as an unrelated internal error rather than this 64.
  if (typeof agent !== 'string' || !AGENT_NAME_RE.test(agent)) {
    return err(EXIT_USAGE, `invalid --agent ${JSON.stringify(agent)} (expected ${AGENT_NAME_RE})`);
  }
  // `host` has a real default ('claude-code', applied once validation passes) — only a
  // DEFINED-but-wrong-shaped value is rejected here.
  if (host !== undefined && (typeof host !== 'string' || host === '')) {
    return err(EXIT_USAGE, `--host requires a non-empty string, got ${JSON.stringify(host)}`);
  }
  // Validated here, before resolveCeiling() ever touches disk, so a rejected argument can never
  // leave a persisted state file behind.
  if (ceiling !== undefined) {
    if (typeof ceiling !== 'string' || ceiling === '') {
      return err(EXIT_USAGE, `--ceiling requires a non-empty string, got ${JSON.stringify(ceiling)}`);
    }
    if (!VALID_COSTS.includes(ceiling)) {
      return err(EXIT_USAGE, `--ceiling expected one of ${VALID_COSTS.join('|')}, got "${ceiling}"`);
    }
  }
  // Same reasoning for the env-var channel: SOMI_COST_CEILING is caller input like --ceiling, so a
  // bad value is 64 here, never routed into resolveCeiling() to surface as a project-env failure
  // (67) alongside a genuinely corrupt config/state file.
  const envCeiling = process.env[CEILING_ENV];
  if (envCeiling && !VALID_COSTS.includes(envCeiling)) {
    return err(EXIT_USAGE, `${CEILING_ENV} expected one of ${VALID_COSTS.join('|')}, got "${envCeiling}"`);
  }
  return { ok: true };
}

/**
 * Resolves one agent's dispatch tier + model. `host` defaults to `'claude-code'` when not given;
 * `ceiling`, when given, is this call's explicit override. Both, and `agent`, are validated by
 * `validateDispatchArgs` above. `projectRoot`/`installRoot` are plain strings the caller resolves
 * itself (the CLI's own convention differs from the MCP server's — see mcp-project-root.mjs).
 * `persist: false` makes the call read-only: an explicit or env ceiling is used but never remembered.
 * The result's `agent_type` is the id the host's subagent tool takes for this agent (`somi:<agent>`
 * on both shipped hosts), or null for a host with no registration (see agent-registry.mjs).
 *
 * @returns {{ok: true, result: object} | {ok: false, code: number, message: string}}
 */
export function resolveDispatch({ agent, host, ceiling, projectRoot, installRoot, persist = true }) {
  const validated = validateDispatchArgs({ agent, host, ceiling });
  if (!validated.ok) return validated;
  const HOST = host || 'claude-code';

  const agentPath = path.join(installRoot, 'agents', `${agent}.md`);
  let content;
  try {
    content = fs.readFileSync(agentPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return err(EXIT_UNKNOWN_AGENT, `unknown agent "${agent}" (no ${agentPath})`);
    throw e;
  }

  // The agent's own tier comes from the shipped default table, never from the agent file: a
  // leftover `cost:` line in the file is ignored. `somi` is the one agent with no table entry on
  // purpose; any other agent file the table doesn't know is a gap in the plugin itself (66).
  if (agent === 'somi') {
    return err(
      EXIT_MALFORMED,
      `agent "somi" is exempt from cost: — the host binds its model when the user selects it ` +
      `in the host's own UI, so there is nothing for this resolver to compute`,
    );
  }
  const defaultTier = AGENT_DEFAULT_TIERS[agent];
  if (defaultTier === undefined) {
    return err(EXIT_MALFORMED, `agent "${agent}" has no entry in the default tier table (scripts/lib/cost-defaults.mjs)`);
  }
  const declaredCost = [defaultTier];

  // Both --ceiling and SOMI_COST_CEILING were already syntax-checked above, before any disk write —
  // so anything resolveCeiling() throws now is the PROJECT's own persisted state, not this call's
  // arguments: an unparsable .somi/config.json, or a corrupt .somi/somi-state/ceiling.json.
  let ceilingResult;
  try {
    ceilingResult = resolveCeiling(projectRoot, ceiling || undefined, { persist });
  } catch (e) {
    return err(EXIT_PROJECT_ENV, e.message);
  }

  // Read fresh per call (see this file's header): this is how a project on a
  // host SoMi doesn't ship a mapping for (e.g. Copilot) tells SoMi which of ITS models counts as
  // low/medium/high. Captured once, before the merge, and kept around past it: modelForDispatch's
  // own catch below needs to know whether the PROJECT's mapping named this specific host at all,
  // to attribute a later resolution failure correctly.
  let projectMapping;
  let override;
  try {
    const costConfig = readCostConfig(projectRoot);
    projectMapping = costConfig.mapping;
    // hasOwn, not a plain lookup: the map is null-prototype already, but this keeps "no entry"
    // meaning "follows the ceiling" for any name, including ones like "constructor".
    if (costConfig.agents && Object.hasOwn(costConfig.agents, agent)) override = costConfig.agents[agent];
  } catch (e) {
    return err(EXIT_PROJECT_ENV, e.message);
  }
  // readCostConfig already validated it; re-checked here so an invalid override can only ever be the
  // project's file (67), never reach decideDispatch's agent-declaration error path (66).
  if (override !== undefined && !VALID_COSTS.includes(override)) {
    return err(EXIT_PROJECT_ENV, `cost.agents.${agent} expected one of ${VALID_COSTS.join('|')}, got ${JSON.stringify(override)}`);
  }

  // mergeHostMapping rejects a __proto__/constructor/prototype key, a non-object per-host value,
  // and a tier key outside low|medium|high outright — kept in its own try/catch, distinct from
  // decideDispatch/modelForDispatch below: this fails only on the PROJECT's own persisted
  // .somi/config.json being structurally broken, never on this agent's own default tier.
  let mapping;
  try {
    mapping = mergeHostMapping(HOST_MODELS, projectMapping);
  } catch (e) {
    return err(EXIT_PROJECT_ENV, e.message);
  }

  // The override and ceiling are validated by now, so decideDispatch failing is this AGENT's own
  // default tier (66) -- unrelated to the mapping, so it stays in its own try/catch.
  let decision;
  try {
    decision = decideDispatch(declaredCost, ceilingResult.ceiling, override);
  } catch (e) {
    return err(EXIT_MALFORMED, e.message);
  }

  // modelForDispatch failing here means the MERGED mapping is shape-valid but incomplete or wrong
  // for the tier this call actually selected (the ceiling, or the agent's override). Whose fault that is turns on whether the project's
  // OWN cost.mapping named this host at all: if it did, the gap is the project's own file (67),
  // and the message says so explicitly. Only a host the project's mapping never mentioned failing
  // this way would point at a bug in the shipped HOST_MODELS table itself, which stays 66.
  let model;
  try {
    model = modelForDispatch(decision, HOST, mapping);
  } catch (e) {
    if (projectMapping && Object.hasOwn(projectMapping, HOST)) {
      return err(EXIT_PROJECT_ENV, `${e.message} (in .somi/config.json cost.mapping)`);
    }
    return err(EXIT_MALFORMED, e.message);
  }

  // `enforced` is true only when a concrete model id came out of the merged mapping (shipped table
  // or the project's cost.mapping). A null model means nothing pins the tier on this host: the
  // agent runs on whatever the host picks, so a caller must not report the tier as "dispatched".
  const enforced = model !== null;
  const modelFields = enforced
    ? { enforced }
    : { enforced, reason: `no model mapping for host ${HOST} (set cost.mapping.${HOST} with low, medium and high in .somi/config.json)` };

  return {
    ok: true,
    result: {
      agent,
      agent_type: agentTypeFor(REGISTRY, agent, HOST),
      supported: decision.supported,
      declared: decision.supported,
      tier: decision.selected,
      degraded: decision.degraded,
      tier_source: decision.tier_source,
      model,
      ...modelFields,
      ceiling: ceilingResult.ceiling,
      ceiling_source: ceilingResult.source,
      ceiling_origin: ceilingResult.ceiling_origin,
    },
  };
}
