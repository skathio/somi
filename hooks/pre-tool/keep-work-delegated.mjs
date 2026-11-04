#!/usr/bin/env node
// PreToolUse on file writes. A reviewer reads and reports, on either host, and shared agent files cannot say so because tool names
// differ per host. In the main thread: while a code workflow is open, the worker writes, so the work runs on the routed tier
// and not the session's. This is a cost control and not a security boundary, because a shell command can still write. It stays off on
// Copilot CLI, where a denied agent gives up instead of delegating.

import { deriveCursor, readEvents } from '../../scripts/lib/journal.mjs';
import { detectHost } from '../../scripts/lib/tiers.mjs';
import { WORKFLOWS } from '../../scripts/lib/workflows.mjs';
import { denyPretool, projectRoot, readPayload, runHook } from '../lib/common.mjs';

runHook(() => {
  const payload = readPayload();
  const subagent = payload.agent_id ?? payload.agentId;
  if (subagent && /reviewer$/.test(String(payload.agent_type ?? payload.agentType ?? ''))) denyPretool(payload, 'SoMi: a reviewer reads and reports. It does not edit.');
  if (detectHost() !== 'claude' || subagent) return;
  const root = projectRoot();
  if (root === null) return;
  const c = deriveCursor(readEvents(root));
  if (!c.route || WORKFLOWS[c.route]?.kind !== 'code' || c.milestone === null) return;
  denyPretool(payload, 'SoMi: a workflow is open, so a worker makes the edits. Follow the `how` field of the last somi_step answer.');
});
