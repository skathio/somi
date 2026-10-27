// config-files.mjs -- where SoMi's config lives, how it is read, and how the files combine. Every
// reader of the config goes through loadConfig() so the hooks, the loops and the resolver cannot
// disagree on what is configured.
//
// Two files, both optional, the same schema:
//   global   one per user, read by every project and session (see globalConfigPath below)
//   project  <root>/.somi/config.json, usually committed
// The effective config is the global file with the project file merged over it: objects merge key
// by key, recursively; any other value (string, number, boolean, null, array) replaces. A project
// that sets only cost.agents.somi-coder and cost.mapping.<host>.medium therefore changes exactly
// those two, and a model list in the project replaces the global list for that tier, never extends it.
//
// Reading follows links: a junction or symlinked .somi, or a config file linked from elsewhere, is
// read through. What the read refuses is what could hurt: anything that is not a regular file once
// opened (a FIFO cannot hang the open, O_NONBLOCK; /dev/zero is not a regular file) and anything over
// MAX_CONFIG_BYTES, both checked on the open descriptor. A project config is untrusted (cloned) input
// either way: following a link lets a hostile repo choose which file is read, not see it, because no
// message echoes file text. Writers never follow links; see scripts/somi-config.mjs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MAX_CONFIG_BYTES = 64 * 1024;
export const GLOBAL_CONFIG_ENV = 'SOMI_GLOBAL_CONFIG';

const READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0);

export class ConfigFileError extends Error {}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/**
 * The global config file, or null when there is none to read. SOMI_GLOBAL_CONFIG wins when set (a
 * path; empty means no global config). Otherwise %APPDATA%\somi\config.json on Windows, else
 * $XDG_CONFIG_HOME/somi/config.json (an absolute XDG_CONFIG_HOME only), else ~/.config/somi/config.json.
 */
export function globalConfigPath(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env[GLOBAL_CONFIG_ENV] !== undefined) {
    const p = env[GLOBAL_CONFIG_ENV];
    return p === '' || p.includes('${') ? null : path.resolve(p);
  }
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'somi', 'config.json');
  const xdg = env.XDG_CONFIG_HOME;
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(home, '.config'), 'somi', 'config.json');
}

export const projectConfigPath = (root) => path.join(root, '.somi', 'config.json');

/** The file's text (links followed), or null when nothing is there. Throws ConfigFileError otherwise,
 * including for a link to a missing file. */
export function readConfigText(file) {
  let fd;
  try {
    fd = fs.openSync(file, READ_FLAGS);
  } catch (e) {
    // A link whose target is gone (say, a shared drive not mounted) is not "no config": the policy it
    // pointed to would silently fall back to the defaults.
    if (e.code === 'ENOENT' && !fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) return null;
    throw new ConfigFileError(`${file} cannot be opened (${e.code === 'ENOENT' ? 'a link to a missing file' : e.code ?? 'error'})`);
  }
  try {
    if (!fs.fstatSync(fd).isFile()) throw new ConfigFileError(`${file} is not a regular file`);
    const buf = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let n = 0;
    while (n < buf.length) {
      const got = fs.readSync(fd, buf, n, buf.length - n, null);
      if (got === 0) break;
      n += got;
    }
    if (n > MAX_CONFIG_BYTES) throw new ConfigFileError(`${file} is over the ${MAX_CONFIG_BYTES}-byte limit`);
    return buf.toString('utf8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Parses config text into a JSON object. The parser's own message quotes the text, so only its error
 * name and position are reported. Which keys are legal is the validators' decision (cost-config.mjs);
 * a `__proto__` key stays an ordinary own property here and in mergeConfig, never a prototype.
 */
export function parseConfigText(text, file) {
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch (e) {
    const pos = /position (\d+)/.exec(String(e.message))?.[1];
    throw new ConfigFileError(`${file} is not valid JSON (${JSON.stringify(e.name)}${pos ? ` at position ${pos}` : ''})`);
  }
  if (!isObj(cfg)) throw new ConfigFileError(`${file} is not a JSON object`);
  return cfg;
}

/** The parsed file, or null when absent. */
export function readConfigFile(file) {
  const text = readConfigText(file);
  return text === null ? null : parseConfigText(text, file);
}

// A deep copy whose keys are all own data properties (JSON.parse defines, never assigns), so a
// `__proto__` key is copied as data and cannot set a prototype.
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const define = (obj, k, v) => Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });

/** `over` merged onto `base` into a new object; neither argument is modified. Both must be objects. */
export function mergeConfig(base, over) {
  const out = copy(base);
  for (const [k, v] of Object.entries(over)) {
    const prev = Object.hasOwn(out, k) ? out[k] : undefined;
    define(out, k, isObj(v) && isObj(prev) ? mergeConfig(prev, v) : copy(v));
  }
  return out;
}

/**
 * The effective config for a project: {config, global, project}, each file as {path, present, config}
 * (`path` null for a global config that is switched off). Throws ConfigFileError naming the file.
 */
export function loadConfig(root, env = process.env) {
  const gPath = globalConfigPath(env);
  const pPath = projectConfigPath(root);
  const g = gPath ? readConfigFile(gPath) : null;
  const p = readConfigFile(pPath);
  return {
    config: mergeConfig(g ?? {}, p ?? {}),
    global: { path: gPath, present: g !== null, config: g ?? {} },
    project: { path: pPath, present: p !== null, config: p ?? {} },
  };
}
