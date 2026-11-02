#!/usr/bin/env node
// SessionStart hook: hands the model the rules digest and the CLI's path once per session, and warns when the sandbox is off. The
// digest is deliberately not injected on every turn, because that repeats its cost each turn and adds nothing new.

import fs from 'node:fs';
import path from 'node:path';
import { pluginRoot, projectRoot, readPayload, runHook } from '../lib/common.mjs';
import { sandboxSettings, settingsWarnings } from '../../scripts/lib/doctor.mjs';
import { detectHost } from '../../scripts/lib/tiers.mjs';

runHook(() => {
  readPayload();
  const root = pluginRoot();
  if (root === null) return;
  const host = detectHost();
  const parts = [fs.readFileSync(path.join(root, 'rules', 'digest.md'), 'utf8').trim()];
  parts.push(`SoMi CLI: \`node "${path.join(root, 'scripts', 'somi.mjs')}"\`, written as \`somi\` in SoMi's commands.`);
  const warnings = settingsWarnings(host, sandboxSettings({ host, root: projectRoot() }));
  if (warnings.length > 0) parts.push(`WARNING: the OS sandbox, SoMi's security boundary, needs attention: ${warnings[0]}. Hooks are tripwires, not a boundary. Run \`somi doctor\`, and tell the user.`);
  const context = parts.join('\n\n');
  // Copilot CLI reads the top-level field and Claude Code the nested one. Each ignores the other's.
  process.stdout.write(`${JSON.stringify({ additionalContext: context, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } })}\n`);
});
