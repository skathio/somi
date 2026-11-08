#!/usr/bin/env node
// Stop, on Claude Code: before the agent ends a turn, the diff decides whether a review is due and whether the change meets the quality
// limits, so the model does not have to remember either. When the gate fails, or a signal fired and no review covers the change, the turn
// goes on once with the reasons: the quality failures first, so the review reads the code that is finished. It asks once per tree, so
// it never loops, and when it cannot read the repository it lets the turn end. The file keeps its name because init writes it into a
// Copilot project's hooks.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../scripts/lib/config-files.mjs';
import { stateIsTracked } from '../../scripts/lib/git-tree.mjs';
import { somiCommand } from '../../scripts/lib/advisor.mjs';
import { qualityStep } from '../../scripts/lib/quality/run.mjs';
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
  const asked = path.join(statePaths(root).dir, 'review-asked.json');
  try { if (JSON.parse(fs.readFileSync(asked, 'utf8')).tree === plan.tree) return; } catch { /* not asked about this tree yet */ }
  const quality = qualityStep(root, { scope: 'pr', env: process.env });
  const reasons = [
    ...(quality.ok ? [] : [`SoMi: this change is over the quality limits:\n${quality.failures.join('\n')}\nRefactor until \`${somiCommand('quality --scope pr')}\` passes, with the tests still green. Do not add a somi-gate-allow exemption to get past it: that is the user's call. If a limit cannot be met, or the code over it is not code you wrote in this conversation, tell the user which and why instead.`]),
    ...(plan.needed ? [`SoMi: this change needs a review before it is finished (${plan.signals.join(', ')}). Call somi_review, start the reviewers it names with their briefs, and record what they return. If the user said not to review, tell them it is due and stop.`] : []),
  ];
  try { writeStateFile(root, asked, `${JSON.stringify({ tree: plan.tree })}\n`); } catch { return; }
  if (reasons.length === 0) return;
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: reasons.join('\n\n') })}\n`);
});
