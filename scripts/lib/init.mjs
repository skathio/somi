// init.mjs: writes `.github/hooks/somi.json`, so Copilot CLI runs the same tripwire scripts as Claude Code, and an extension that
// registers SoMi's staged workflows with it. The Claude Code plugin install needs none of this. Paths are absolute because a repository hook file has no plugin-root variable to expand.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
        entry(pluginRoot, 'pre-tool/apply-tier.mjs', 'Agent|Task|task'),
      ],
      UserPromptSubmit: [entry(pluginRoot, 'user-prompt/capture-prompt.mjs')],
      PostToolUse: [entry(pluginRoot, 'post-tool/audit-log.mjs', '*')],
      Stop: [entry(pluginRoot, 'stop/review-due.mjs')],
    },
  };
}

// Copilot loads a workflow only from an extension. This one is a few lines that load SoMi's own module from the plugin.
export function copilotExtension(pluginRoot) {
  const lib = pathToFileURL(path.join(pluginRoot, 'scripts', 'lib', 'copilot-workflow.mjs')).href;
  return `// Written by somi init: registers SoMi's staged workflows with Copilot CLI. Remove this folder to turn them off.\nimport { defineWorkflow, joinSession } from '@github/copilot-sdk/extension';\n\nconst { registerCopilotWorkflows } = await import(${JSON.stringify(lib)});\nawait registerCopilotWorkflows({ defineWorkflow, joinSession });\n`;
}

export function writeCopilotExtension(root, pluginRoot) {
  return writeOnce(path.join(root, '.github', 'extensions', 'somi', 'extension.mjs'), copilotExtension(pluginRoot), 'extension.mjs');
}

function writeOnce(file, text, label) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== text) return { written: false, file, reason: `a different ${label} is already there; remove it first` };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { written: true, file };
}

export function writeCopilotHooks(root, pluginRoot) {
  return writeOnce(path.join(root, '.github', 'hooks', 'somi.json'), `${JSON.stringify(copilotHooks(pluginRoot), null, 2)}\n`, 'somi.json');
}
