#!/usr/bin/env node
// PreToolUse on subagent starts: a SoMi agent runs on its tier's model, because a tier that depends on an agent remembering to pass it gets
// skipped. The tier is in the agent's name, so this needs no state, and it leaves every other agent alone. It rewrites and never denies,
// because a denial makes some hosts do the work inline. A tier with no model in this environment's config changes nothing. On Claude Code a SoMi
// agent also stays in the foreground: one in the background cannot ask for a permission, so a reviewer's diff command is denied and it reviews blind.

import { loadConfig } from '../../scripts/lib/config-files.mjs';
import { detectHost, resolveSpawn } from '../../scripts/lib/tiers.mjs';
import { ASKED_SECURITY_REVIEW, tierForReviewer, tierForWorker } from '../../scripts/lib/workflows.mjs';
import { projectRoot, readPayload, runHook } from '../lib/common.mjs';

// Who reviews is review policy, so a committed project config cannot lower it. Only the user's own config can. A security review the
// user asked for carries SoMi's marker in its brief and runs on high; a session choosing a model on its own does not change the tier.
function modelFor(agent, loaded, host, prompt) {
  const asked = typeof prompt === 'string' && prompt.startsWith(ASKED_SECURITY_REVIEW);
  const reviewerTier = tierForReviewer(agent, { global: loaded.global.config, project: loaded.project.config }, { asked });
  if (!reviewerTier) return resolveSpawn(loaded.config, host, tierForWorker(agent)).model;
  return resolveSpawn(loaded.global.config ?? {}, host, reviewerTier).model;
}

runHook(() => {
  const payload = readPayload();
  let args = payload.tool_input ?? payload.toolArgs ?? {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { return; } }
  const agent = args.subagent_type ?? args.agent_type;
  if (!tierForReviewer(agent) && !tierForWorker(agent)) return;
  const root = projectRoot();
  if (root === null) return;
  let loaded;
  try { loaded = loadConfig(root); } catch { return; }
  const host = detectHost();
  const model = modelFor(agent, loaded, host, args.prompt ?? args.description);
  const background = host === 'claude' && args.run_in_background !== false;
  if ((!model || args.model === model) && !background) return;
  const updated = { ...args, ...(model ? { model } : {}), ...(background ? { run_in_background: false } : {}) };
  process.stdout.write(JSON.stringify({ modifiedArgs: updated, permissionDecision: 'allow', hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: updated } }));
});
