// Copilot CLI registers a workflow from an extension, not from a plugin's workflows folder, and hands it ctx.agent and the rest instead
// of globals. This runs the same workflow files there, so the two hosts share one source for every stage and its tier.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOWS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'workflows');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
// Copilot's agent options, exactly. Anything else is dropped rather than sent, and agentType is Copilot's agent.
const AGENT_OPTIONS = ['label', 'schema', 'model', 'agent', 'reasoningEffort', 'contextTier'];
export const copilotName = (name) => `somi-${name}`;

/** A workflow file's literal meta and its body, which runs with agent, pipeline, parallel, phase, log and args in scope. */
export function parseWorkflow(text) {
  const m = /^export const meta = (\{[\s\S]*?\n\})\n/.exec(text);
  if (!m) throw new Error('a workflow file starts with its meta, a literal');
  return { meta: Function(`return (${m[1]})`)(), body: text.slice(m[0].length) };
}

export function copilotAgentOptions({ agentType, effort, ...rest } = {}) {
  const opts = { ...rest, ...(agentType ? { agent: agentType } : {}), ...(effort ? { reasoningEffort: effort } : {}) };
  return Object.fromEntries(Object.entries(opts).filter(([k]) => AGENT_OPTIONS.includes(k)));
}

/** Runs a parsed workflow against a Copilot run context. */
export function runOnCopilot({ body }, ctx) {
  const agent = (prompt, opts) => ctx.agent(prompt, copilotAgentOptions(opts));
  const run = new AsyncFunction('agent', 'pipeline', 'parallel', 'phase', 'log', 'args', body);
  return run(agent, (items, ...stages) => ctx.pipeline(items, ...stages), (thunks) => ctx.parallel(thunks), (t) => ctx.phase(t), (m) => ctx.log(m), ctx.args);
}

/** Called by the extension `somi init` writes, with the SDK's own functions, which resolve only inside the extension's process. */
export async function registerCopilotWorkflows({ defineWorkflow, joinSession, dir = WORKFLOWS_DIR }) {
  const workflows = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort().map((f) => {
    const parsed = parseWorkflow(fs.readFileSync(path.join(dir, f), 'utf8'));
    const { name, description, phases } = parsed.meta;
    return defineWorkflow({ meta: { name: copilotName(name), description, phases }, run: (ctx) => runOnCopilot(parsed, ctx) });
  });
  return joinSession({ workflows });
}
