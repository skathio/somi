// init.mjs: registers SoMi's staged workflows with Copilot CLI, which loads a workflow only from an extension. Copilot also reads
// extensions from the user's own folder, so one file there serves every project, and the session-start hook keeps it pointing at the
// installed plugin. Nothing is written into a project, and the Claude Code plugin install needs none of this.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MARK = '// Written by SoMi:';
// An earlier somi init wrote this into the project. With the user's copy as well, both register the same workflow names.
const PROJECT_MARK = '// Written by somi init:';

const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

export const copilotExtensionFile = (env = process.env, home = os.homedir()) => path.join(env.COPILOT_HOME || path.join(home, '.copilot'), 'extensions', 'somi', 'extension.mjs');

// A few lines that load SoMi's own module from the plugin. When the plugin is gone, it joins with nothing rather than failing to load.
export function copilotExtension(pluginRoot) {
  const lib = pathToFileURL(path.join(pluginRoot, 'scripts', 'lib', 'copilot-workflow.mjs')).href;
  return `${MARK} registers SoMi's staged workflows with Copilot CLI for every project. SoMi rewrites it at session start while the plugin is
// installed. To turn it off, set "copilot": { "workflows": false } in SoMi's global config and delete this folder.
import fs from 'node:fs';
import { defineWorkflow, joinSession } from '@github/copilot-sdk/extension';

const lib = new URL(${JSON.stringify(lib)});
if (fs.existsSync(lib)) {
  const { registerCopilotWorkflows } = await import(lib.href);
  await registerCopilotWorkflows({ defineWorkflow, joinSession });
} else {
  await joinSession({});
}
`;
}

/** Writes the user's copy, or brings it up to date. A file SoMi did not write is left alone, and a link is never written through. */
export function installCopilotExtension({ pluginRoot, env = process.env, home = os.homedir() }) {
  const file = copilotExtensionFile(env, home);
  const text = copilotExtension(pluginRoot);
  try {
    if (isLink(path.dirname(file)) || isLink(file)) return { written: false, file, reason: 'it is a link, and SoMi does not write through one' };
    if (fs.existsSync(file)) {
      const current = fs.readFileSync(file, 'utf8');
      if (current === text) return { written: false, current: true, file };
      if (!current.startsWith(MARK)) return { written: false, file, reason: 'a different extension.mjs is already there; SoMi leaves it alone' };
    }
    // A session starting at the same moment reads the old file or the new one, never half of one.
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
    return { written: true, file };
  } catch (e) {
    return { written: false, file, reason: e.message };
  }
}

/** Whether p is dir or inside it. A folder whose name starts with two dots is inside. */
export function isInside(dir, p) {
  const rel = path.relative(dir, p);
  return !(rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
}

/** The global config can turn the user's copy off. A project's cannot, because the file serves every project. */
export const copilotWorkflowsOn = (globalConfig) => globalConfig?.copilot?.workflows !== false;

export function projectExtensionWarnings(root) {
  const file = path.join(root, '.github', 'extensions', 'somi', 'extension.mjs');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.startsWith(PROJECT_MARK) ? [`${file} was written by an earlier somi init, and SoMi now registers its workflows once for every project, so they are registered twice here; delete that folder`] : [];
}
