#!/usr/bin/env node
// Stop, on Claude Code: before the agent ends a turn, the diff decides whether a review is due, so the model does not have to remember to
// ask. When a signal fired and no review covers the change, the turn goes on once with the reason. It asks once per tree, so it never
// loops, and when it cannot read the repository it lets the turn end.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../scripts/lib/config-files.mjs';
import { stateIsTracked } from '../../scripts/lib/git-tree.mjs';
import { reviewPlan } from '../../scripts/lib/reviews.mjs';
import { statePaths, writeStateFile } from '../../scripts/lib/state.mjs';
import { detectHost } from '../../scripts/lib/tiers.mjs';
import { projectRoot, readPayload, runHook } from '../lib/common.mjs';

runHook(() => {
  const payload = readPayload();
  if (detectHost() !== 'claude' || payload.stop_hook_active === true || payload.agent_id) return;
  const root = projectRoot();
  if (root === null) return;
  let plan;
  try {
    if (!process.env.SOMI_STATE_DIR && stateIsTracked(root)) return;
    let loaded = { config: {}, global: { config: {} }, project: { config: {} } };
    try { loaded = loadConfig(root); } catch { /* built-in signals still apply */ }
    plan = reviewPlan({ root, env: process.env, config: loaded.config, configLayers: [loaded.global.config ?? {}, loaded.project.config ?? {}], host: 'claude', now: () => new Date().toISOString() });
  } catch { return; }
  if (!plan.needed) return;
  const asked = path.join(statePaths(root).dir, 'review-asked.json');
  try { if (JSON.parse(fs.readFileSync(asked, 'utf8')).tree === plan.tree) return; } catch { /* not asked about this tree yet */ }
  try { writeStateFile(root, asked, `${JSON.stringify({ tree: plan.tree })}\n`); } catch { return; }
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: `SoMi: this change needs a review before it is finished (${plan.signals.join(', ')}). Call somi_review, start the reviewers it names with their briefs, and record what they return. If the user said not to review, tell them it is due and stop.` })}\n`);
});
