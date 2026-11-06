// init.mjs: writes `.github/hooks/somi.json`, so Copilot CLI runs the same tripwire scripts as Claude Code. The Claude Code plugin
// install needs none of this. Paths are absolute because a repository hook file has no plugin-root variable to expand.

import fs from 'node:fs';
import path from 'node:path';

const quoted = (s) => `'${s.replaceAll("'", "'\\''")}'`;

function entry(pluginRoot, script, matcher) {
  const abs = path.join(pluginRoot, 'hooks', script);
  return {
    type: 'command',
    ...(matcher ? { matcher } : {}),
    bash: `SOMI_HOST=copilot node ${quoted(abs)}`,
    powershell: `$env:SOMI_HOST='copilot'; node ${quoted(abs)}`,
    timeoutSec: 10,
  };
}

export function copilotHooks(pluginRoot) {
  return {
    version: 1,
    hooks: {
      SessionStart: [entry(pluginRoot, 'session-start/inject-digest.mjs')],
      PreToolUse: [
        entry(pluginRoot, 'pre-tool/block-dangerous-bash.mjs', 'Bash'),
        entry(pluginRoot, 'pre-tool/gate-dep-install.mjs', 'Bash'),
        entry(pluginRoot, 'pre-tool/block-secret-writes.mjs', 'Write|Edit|MultiEdit|NotebookEdit'),
        entry(pluginRoot, 'pre-tool/guard-protected-paths.mjs', 'Write|Edit|MultiEdit|NotebookEdit'),
        entry(pluginRoot, 'pre-tool/guard-tier-config.mjs', 'Write|Edit|MultiEdit|NotebookEdit'),
        entry(pluginRoot, 'pre-tool/reviewers-read-only.mjs', 'Write|Edit|MultiEdit|NotebookEdit'),
        entry(pluginRoot, 'pre-tool/keep-delegated.mjs', 'Write|Edit|MultiEdit|NotebookEdit'),
        entry(pluginRoot, 'pre-tool/apply-tier.mjs', 'Agent|Task|task'),
      ],
      UserPromptSubmit: [entry(pluginRoot, 'user-prompt/capture-prompt.mjs')],
      PostToolUse: [entry(pluginRoot, 'post-tool/audit-log.mjs', '*')],
      Stop: [entry(pluginRoot, 'stop/review-due.mjs')],
    },
  };
}

export function writeCopilotHooks(root, pluginRoot) {
  const dir = path.join(root, '.github', 'hooks');
  const file = path.join(dir, 'somi.json');
  const text = `${JSON.stringify(copilotHooks(pluginRoot), null, 2)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== text) return { written: false, file, reason: 'a different somi.json is already there; remove it first' };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, text);
  return { written: true, file };
}
