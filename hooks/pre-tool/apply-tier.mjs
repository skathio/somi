#!/usr/bin/env node
// PreToolUse on subagent starts: while a SoMi route is open, the tier comes from the engine and not from what the agent remembered to
// pass. Asking a model to look up a tier and obey it is the weak link, and a denial makes some hosts do the work inline instead, so
// this rewrites and never denies. It applies at every level, because a worker's own subagents otherwise fall back to the session's
// model. A tier with no model in this environment's config changes nothing.

import { loadConfig } from '../../scripts/lib/config-files.mjs';
import { deriveCursor, readEvents } from '../../scripts/lib/journal.mjs';
import { detectHost, resolveSpawn } from '../../scripts/lib/tiers.mjs';
import { tierForAgent } from '../../scripts/lib/workflows.mjs';
import { projectRoot, readPayload, runHook } from '../lib/common.mjs';

runHook(() => {
  const payload = readPayload();
  let args = payload.tool_input ?? payload.toolArgs ?? {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { return; } }
  const root = projectRoot();
  if (root === null) return;
  const c = deriveCursor(readEvents(root));
  if (!c.route) return;
  let config = {};
  try { ({ config } = loadConfig(root)); } catch { return; }
  const wanted = tierForAgent(args.subagent_type ?? args.agent_type) ?? c.tier;
  if (!wanted) return;
  const { model } = resolveSpawn(config, detectHost(), wanted);
  if (!model || args.model === model) return;
  const updated = { ...args, model };
  process.stdout.write(JSON.stringify({ modifiedArgs: updated, permissionDecision: 'allow', hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: updated } }));
});
