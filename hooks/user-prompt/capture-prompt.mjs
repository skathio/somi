#!/usr/bin/env node
// UserPromptSubmit: keeps the user's messages so SoMi's tools can read the user's own words, not only the agent's summary of them.
// It adds nothing to the conversation and never blocks a prompt. A committed state folder is not trusted, so nothing is written there.

import { stateIsTracked } from '../../scripts/lib/git-tree.mjs';
import { savePrompt } from '../../scripts/lib/prompt.mjs';
import { projectRoot, readPayload, runHook } from '../lib/common.mjs';

runHook(() => {
  const payload = readPayload();
  const root = projectRoot();
  if (root === null) return;
  try {
    if (!process.env.SOMI_STATE_DIR && stateIsTracked(root)) return;
    savePrompt(root, payload.prompt ?? payload.userPrompt ?? '', process.env, { session: payload.session_id ?? payload.sessionId });
  } catch { /* a prompt must never fail because SoMi could not keep a copy */ }
});
