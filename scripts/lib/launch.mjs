// launch.mjs: starts Claude Code or Copilot CLI with SoMi's agent, on the model the user's global config sets for the conversation's
// tier. Only the global config counts here: a project's is cloned input, and it should not pick the model a session starts on.

import fs from 'node:fs';
import path from 'node:path';
import { mainTier, resolveSpawn } from './tiers.mjs';

export const LAUNCH_HOSTS = Object.freeze(['claude', 'copilot']);
const AGENT = 'somi:somi';

const passed = (extra, flag) => extra.some((a) => a === flag || a.startsWith(`${flag}=`));

/** The command and arguments to run. What the user passes comes last, and a flag they pass themselves is not added. */
export function launchPlan({ host, config = {}, extra = [] }) {
  const tier = mainTier(config);
  const { model } = resolveSpawn(config, host, tier);
  const args = [
    ...(passed(extra, '--agent') ? [] : ['--agent', AGENT]),
    ...(model && !passed(extra, '--model') ? ['--model', model] : []),
    // /somi-deliver runs as a Copilot workflow, which needs experimental mode.
    ...(host === 'copilot' && !passed(extra, '--experimental') && !passed(extra, '--no-experimental') ? ['--experimental'] : []),
    ...extra,
  ];
  const warnings = model ? [] : [`no model is set for tier ${tier} on ${host}, so ${host} starts on its own default; set tiers.${host}.${tier} in SoMi's global config`];
  return { command: host, args, tier, model, warnings };
}

// Windows: an npm install puts each host on the PATH as a .cmd shim, which only cmd.exe can start, so the line is quoted for cmd.exe
// and for the C runtime that splits it again, the way cross-spawn does it. A native .exe starts directly, as it does everywhere else.
const META = /([()\][%!^"`<>&|;, *?])/g;
const escapeCommand = (file) => file.replace(META, '^$1');
function escapeArgument(arg, shim) {
  const quoted = `"${String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`.replace(META, '^$1');
  // A batch file that forwards %* hands its arguments to cmd.exe once more, so they are escaped for that pass too.
  return shim ? quoted.replace(META, '^$1') : quoted;
}

const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const readText = (f) => fs.readFileSync(f, 'utf8');

// Every package manager's shim (npm, pnpm, Yarn, nvm-windows, volta) forwards %*, wherever it is installed, so the file's own text
// decides. One that cannot be read is escaped twice: too many carets only garble an argument, too few let cmd.exe run part of it.
function forwardsArguments(file, read) {
  try { return read(file).includes('%*'); } catch { return true; }
}

/** Where Windows finds a command: each PATH folder in turn, trying each PATHEXT extension. */
export function findOnWindowsPath(name, env, exists = isFile) {
  const exts = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const dir of (env.PATH ?? env.Path ?? '').split(';').filter(Boolean)) {
    for (const ext of exts) if (exists(path.win32.join(dir, `${name}${ext}`))) return path.win32.join(dir, `${name}${ext}`);
  }
  return null;
}

/** How to spawn the command without a shell on POSIX, and on Windows whether it is an .exe or a .cmd shim. Null when it is not found. */
export function spawnPlan(command, args, { platform = process.platform, env = process.env, exists = isFile, read = readText } = {}) {
  if (platform !== 'win32') return { file: command, args, options: {} };
  const found = findOnWindowsPath(command, env, exists);
  if (!found) return null;
  if (!/\.(cmd|bat)$/i.test(found)) return { file: found, args, options: {} };
  const shim = forwardsArguments(found, read);
  const line = [escapeCommand(found), ...args.map((a) => escapeArgument(a, shim))].join(' ');
  return { file: env.ComSpec || env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } };
}
