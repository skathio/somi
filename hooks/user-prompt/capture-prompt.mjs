#!/usr/bin/env node
// UserPromptSubmit: keeps the user's messages so SoMi's tools can read the user's own words, not only the agent's summary of them, and
// the tree as the turn starts, so the Stop hook can tell a turn that changed nothing. It adds nothing to the conversation and never
// blocks a prompt. A committed state folder is not trusted, so nothing is written there.

import { snapshotTree, stateIsTracked } from '../../scripts/lib/git-tree.mjs';
import { isHostNotice, savePrompt } from '../../scripts/lib/prompt.mjs';
import { statePaths, writeStateFile } from '../../scripts/lib/state.mjs';
import { projectRoot, readPayload, runHook } from '../lib/common.mjs';

runHook(() => {
  const payload = readPayload();
  const root = projectRoot();
  if (root === null) return;
  const text = payload.prompt ?? payload.userPrompt ?? '';
  const session = payload.session_id ?? payload.sessionId ?? null;
  try {
    if (!process.env.SOMI_STATE_DIR && stateIsTracked(root)) return;
    savePrompt(root, text, process.env, { session });
    // A host notice, such as a background task finishing, carries on the turn before it, so what that task changed still counts.
    if (typeof text === 'string' && !isHostNotice(text)) writeStateFile(root, statePaths(root).turn, `${JSON.stringify({ session, tree: snapshotTree(root) })}\n`);
  } catch { /* a prompt must never fail because SoMi could not keep a copy */ }
});
