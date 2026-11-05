#!/usr/bin/env node
// PreToolUse on file writes: a reviewer reads and reports, on either host, and shared agent files cannot say so because tool names differ
// per host. Nothing else is limited here. The main agent and workers write freely.

import { denyPretool, readPayload, runHook } from '../lib/common.mjs';

runHook(() => {
  const payload = readPayload();
  const subagent = payload.agent_id ?? payload.agentId;
  if (subagent && /reviewer$/.test(String(payload.agent_type ?? payload.agentType ?? ''))) denyPretool(payload, 'SoMi: a reviewer reads and reports. It does not edit.');
});
