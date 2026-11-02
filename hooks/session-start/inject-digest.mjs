#!/usr/bin/env node
// SessionStart hook: hands the model the rules digest, the CLI's path and the decision ledger at session start and after compaction, and warns when the sandbox is off. The
// digest is deliberately not injected on every turn, because that repeats its cost each turn and adds nothing new.

import fs from 'node:fs';
import path from 'node:path';
import { pluginRoot, projectRoot, readPayload, runHook } from '../lib/common.mjs';
import { sandboxSettings, settingsWarnings } from '../../scripts/lib/doctor.mjs';
import { readLedger } from '../../scripts/lib/ledger.mjs';
import { listShards } from '../../scripts/lib/shards.mjs';
import { detectHost } from '../../scripts/lib/tiers.mjs';
import { updateNotice } from '../../scripts/lib/update-notice.mjs';

runHook(() => {
  const payload = readPayload();
  const root = pluginRoot();
  if (root === null) return;
  const host = detectHost();
  const parts = [fs.readFileSync(path.join(root, 'rules', 'digest.md'), 'utf8').trim()];
  parts.push(`SoMi CLI: \`node "${path.join(root, 'scripts', 'somi.mjs')}"\`, written as \`somi\` in SoMi's commands.`);
  const warnings = settingsWarnings(host, sandboxSettings({ host, root: projectRoot() }));
  if (warnings.length > 0) parts.push(`WARNING: the OS sandbox, SoMi's security boundary, needs attention: ${warnings[0]}. Hooks are tripwires, not a boundary. Run \`somi doctor\`, and tell the user.`);
  // Compaction drops rules and scope limits first. This hook fires on compaction too, so the ledger comes back every time.
  try {
    const project = projectRoot();
    const ledger = project ? readLedger(project) : '';
    if (ledger) parts.push(`Decisions and limits for the open work:\n${ledger}`);
    const held = project ? listShards({ root: project }).filter((b) => b.state !== 'ok') : [];
    if (held.length > 0) parts.push(`Connected steps needing attention: ${held.map((b) => `${b.ref} (${b.state})`).join(', ')}. See \`somi slot --list\`.`);
  } catch { /* a bad state file must not stop a session starting */ }
  const notice = updateNotice();
  if (notice) parts.push(notice);
  // Claude Code names the active agent here. Copilot CLI does not, so nothing can be said about it there.
  if (host === 'claude' && !/(^|:)somi$/.test(payload?.agent_type ?? '')) parts.push('SoMi is not the active agent in this session, so plain prompts are not routed and tiers apply only under `/somi` and SoMi commands. Say so once if the user asks SoMi for work.');
  // Copilot CLI gives an MCP server no project root, so the tool takes it from the session.
  if (host === 'copilot' && payload?.cwd) parts.push(`Pass project_dir "${payload.cwd}" on every somi_step call.`);
  const context = parts.join('\n\n');
  // Copilot CLI reads the top-level field and Claude Code the nested one. Each ignores the other's.
  process.stdout.write(`${JSON.stringify({ additionalContext: context, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } })}\n`);
});
