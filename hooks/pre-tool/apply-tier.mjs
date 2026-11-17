#!/usr/bin/env node
// PreToolUse on subagent starts: a SoMi agent runs on its tier's model, because a tier that depends on an agent remembering to pass it gets
// skipped. The tier is in the agent's name, so this needs no state, and it leaves every other agent alone. It rewrites and never denies,
// because a denial makes some hosts do the work inline. A tier with no model in this environment's config changes nothing. On Claude Code a SoMi
// agent also stays in the foreground: one in the background cannot ask for a permission, so a reviewer's diff command is denied and it reviews blind.

import { loadConfig } from '../../scripts/lib/config-files.mjs';
import { detectHost, resolveSpawn } from '../../scripts/lib/tiers.mjs';
import { tierForReviewer, tierForWorker } from '../../scripts/lib/workflows.mjs';
import { projectRoot, readPayload, runHook } from '../lib/common.mjs';

// Who reviews is review policy, so a committed project config cannot lower it. Only the user's own config can. A reviewer started on the
// high tier's model is a raise, such as a security review the user asked for, so it keeps that model.
function modelFor(agent, loaded, host, requested) {
  const reviewerTier = tierForReviewer(agent, { global: loaded.global.config, project: loaded.project.config });
  if (!reviewerTier) return resolveSpawn(loaded.config, host, tierForWorker(agent)).model;
  const config = loaded.global.config ?? {};
  const high = resolveSpawn(config, host, 'high').model;
  return high && requested === high ? high : resolveSpawn(config, host, reviewerTier).model;
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
  const model = modelFor(agent, loaded, host, args.model);
  const background = host === 'claude' && args.run_in_background !== false;
  if ((!model || args.model === model) && !background) return;
  const updated = { ...args, ...(model ? { model } : {}), ...(background ? { run_in_background: false } : {}) };
  process.stdout.write(JSON.stringify({ modifiedArgs: updated, permissionDecision: 'allow', hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: updated } }));
});
