#!/usr/bin/env node
// PreToolUse on subagent starts: while a SoMi route is open, the tier comes from the engine and not from what the agent remembered to
// pass. Asking a model to look up a tier and obey it is the weak link, and a denial makes some hosts do the work inline instead, so
// this rewrites and never denies. It applies at every level, because a worker's own subagents otherwise fall back to the session's
// model. A tier with no model in this environment's config changes nothing. A SoMi agent also stays in the foreground on Claude Code: one
// left in the background ends the turn when it reports, and with the turn goes the cheap model that the typed command pinned.

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
  let loaded;
  try { loaded = loadConfig(root); } catch { return; }
  const reviewerTier = tierForAgent(args.subagent_type ?? args.agent_type);
  const wanted = reviewerTier ?? c.tier;
  if (!wanted) return;
  // Who reviews is review policy, so a committed project config cannot lower it. Only the user's own config can.
  const host = detectHost();
  const { model } = resolveSpawn(reviewerTier ? loaded.global.config ?? {} : loaded.config, host, wanted);
  const background = host === 'claude' && String(args.subagent_type ?? args.agent_type ?? '').startsWith('somi:') && args.run_in_background !== false;
  if ((!model || args.model === model) && !background) return;
  const updated = { ...args, ...(model ? { model } : {}), ...(background ? { run_in_background: false } : {}) };
  process.stdout.write(JSON.stringify({ modifiedArgs: updated, permissionDecision: 'allow', hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: updated } }));
});
