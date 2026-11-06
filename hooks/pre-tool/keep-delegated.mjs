#!/usr/bin/env node
// PreToolUse on file writes, Claude Code only: while somi_route's note says a change was just sent to a worker, the main thread does not write
// that change itself. It is narrow on purpose. It holds only until a SoMi worker starts or the user's next message, and a shell command can
// still write, so it is a cost control and not a security boundary. It stays off on Copilot CLI, where a denied agent gives up instead of
// delegating, and inside subagents.

import { activeDelegation } from '../../scripts/lib/delegation.mjs';
import { detectHost } from '../../scripts/lib/tiers.mjs';
import { denyPretool, projectRoot, readPayload, runHook } from '../lib/common.mjs';

runHook(() => {
  const payload = readPayload();
  if (detectHost() !== 'claude' || payload.agent_id || payload.agentId) return;
  const root = projectRoot();
  if (root === null) return;
  const note = activeDelegation(root);
  if (!note) return;
  denyPretool(payload, `SoMi: this change was routed to ${note.agent} on the ${note.tier} tier, because it costs less there. Start that worker with the brief somi_route gave you. If the user asked you to do it here, tell them it costs more and do it after their next message.`);
});
