#!/usr/bin/env node
// PreToolUse on subagent starts: a SoMi agent runs on its tier's model, because a tier that depends on an agent remembering to pass it gets
// skipped. The tier is in the agent's name, so this needs no state, and it leaves every other agent alone. It rewrites and never denies,
// because a denial makes some hosts do the work inline. A tier with no model in this environment's config changes nothing. On Claude Code a SoMi
// agent also stays in the foreground: one in the background cannot ask for a permission, so a reviewer's diff command is denied and it reviews blind.

import { loadConfig } from '../../scripts/lib/config-files.mjs';
import { detectHost, resolveSpawn } from '../../scripts/lib/tiers.mjs';
import { tierForReviewer, tierForWorker } from '../../scripts/lib/workflows.mjs';
import { projectRoot, readPayload, runHook } from '../lib/common.mjs';

runHook(() => {
  const payload = readPayload();
  let args = payload.tool_input ?? payload.toolArgs ?? {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { return; } }
  const agent = args.subagent_type ?? args.agent_type;
  const reviewerTier = tierForReviewer(agent);
  const wanted = reviewerTier ?? tierForWorker(agent);
  if (!wanted) return;
  const root = projectRoot();
  if (root === null) return;
  let loaded;
  try { loaded = loadConfig(root); } catch { return; }
  // Who reviews is review policy, so a committed project config cannot lower it. Only the user's own config can.
  const host = detectHost();
  const { model } = resolveSpawn(reviewerTier ? loaded.global.config ?? {} : loaded.config, host, wanted);
  const background = host === 'claude' && args.run_in_background !== false;
  if ((!model || args.model === model) && !background) return;
  const updated = { ...args, ...(model ? { model } : {}), ...(background ? { run_in_background: false } : {}) };
  process.stdout.write(JSON.stringify({ modifiedArgs: updated, permissionDecision: 'allow', hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: updated } }));
});
