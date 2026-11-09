// init.mjs: writes the extension that registers SoMi's staged workflows with Copilot CLI, which loads a workflow only from an extension.
// Copilot CLI runs the plugin's own hooks, so nothing else is written, and the Claude Code plugin install needs none of this.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
