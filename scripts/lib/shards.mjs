// shards.mjs: another plugin's skill, agent or tool slotted into a named workflow step. `somi slot` inspects the plugin and writes a
// binding to config, and the engine reads bindings at each step. There is no typed contract, because a model consumes the output and
// tolerates drift a schema would reject. The check is about what is safe:
//   - a read binding that changed keeps working and says so, because it has to survive that plugin updating;
//   - a missing component is stale, and is skipped with a notice;
//   - a write binding whose content changed asks first. Outward writes always ask, whatever the hash says.
// Shard output is data, never instructions, and the brief says so where it is used.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globalConfigPath } from './config-files.mjs';

export const SHARD_STEPS = Object.freeze(['work-item.start', 'plan.approved', 'pr.open', 'review.done']);
const MODES = Object.freeze(['read', 'write']);
const KINDS = Object.freeze(['skill', 'agent', 'command', 'tool']);
const REF = /^([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)$/;
export class ShardError extends Error {}

// Config is repository content, and these fields reach a worker's brief and session context, so only the exact shape is believed.
const isBinding = (b) => b !== null && typeof b === 'object' && SHARD_STEPS.includes(b.step) && typeof b.ref === 'string' && REF.test(b.ref) && MODES.includes(b.mode) && KINDS.includes(b.kind);
const asList = (v) => (Array.isArray(v) ? v : []);

const sha = (text) => createHash('sha256').update(text).digest('hex');

function pluginDirs(env, home) {
  const out = [];
  const extra = env.SOMI_PLUGIN_DIRS;
  if (extra) out.push(...extra.split(path.delimiter).filter(Boolean));
  for (const root of [path.join(home, '.claude', 'plugins'), path.join(home, '.copilot', 'installed-plugins')]) {
    const walk = (dir, depth) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      if (entries.some((e) => e.name === '.claude-plugin' || e.name === '.copilot-extension' || e.name === 'plugin.json')) out.push(dir);
      if (depth > 0) for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(path.join(dir, e.name), depth - 1);
    };
    walk(root, 5);
  }
  return out;
}

function pluginName(dir) {
  for (const f of ['.claude-plugin/plugin.json', '.copilot-extension/extension.json', 'plugin.json']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (typeof j.name === 'string') return { name: j.name, version: String(j.version ?? 'unknown') };
    } catch { /* try the next manifest */ }
  }
  return { name: path.basename(dir), version: 'unknown' };
}

function findComponent(dir, component) {
  const candidates = [
    ['skill', `skills/${component}/SKILL.md`],
    ['agent', `agents/${component}.md`],
    ['agent', `agents/${component}.agent.md`],
    ['command', `commands/${component}.md`],
    ['tool', '.mcp.json'],
    ['tool', 'mcp.json'],
  ];
  for (const [kind, rel] of candidates) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (kind === 'tool' && !text.includes(`"${component}"`)) continue;
    return { kind, file, text };
  }
  return null;
}

// The newest installed copy wins when a plugin is present more than once, as it is across cached versions.
function locate(ref, env, home) {
  const m = REF.exec(ref);
  if (!m) throw new ShardError('a shard is named plugin:component');
  const hits = pluginDirs(env, home).map((dir) => ({ dir, ...pluginName(dir) })).filter((p) => p.name === m[1]);
  if (hits.length === 0) return null;
  const sorted = hits.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  for (const plugin of sorted) {
    const c = findComponent(plugin.dir, m[2]);
    if (c) return { ...c, version: plugin.version };
  }
  return null;
}

const readJson = (file) => { if (file === null) return {}; try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw new ShardError(`${file} is not valid JSON`); } };
function writeJson(file, value) {
  if (file === null) throw new ShardError('no global config file is set here; use --project');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new ShardError(`refusing to write through a link at ${file}`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

const configFile = (root, env, project) => (project ? path.join(root, '.somi', 'config.json') : globalConfigPath(env));

export function slot({ root, step, ref, mode = 'read', project = false, env = process.env, home = os.homedir(), now }) {
  if (!SHARD_STEPS.includes(step)) throw new ShardError(`a shard slots into one of: ${SHARD_STEPS.join(', ')}`);
  if (!MODES.includes(mode)) throw new ShardError('a shard mode is read or write');
  const found = locate(ref, env, home);
  if (!found) throw new ShardError(`${ref} is not installed; install the plugin first, because SoMi never installs one for you`);
  const file = configFile(root, env, project);
  const config = readJson(file);
  const binding = { step, ref, kind: found.kind, mode, version: found.version, sha256: sha(found.text), bound_at: now };
  config.shards = [...asList(config.shards).filter((b) => !(b?.step === step && b?.ref === ref)), binding];
  writeJson(file, config);
  return { slotted: ref, step, kind: found.kind, mode, version: found.version, scope: project ? 'project' : 'global' };
}

export function unslot({ root, step, ref, project = false, env = process.env }) {
  const file = configFile(root, env, project);
  const config = readJson(file);
  const before = asList(config.shards);
  config.shards = before.filter((b) => !(b?.step === step && b?.ref === ref));
  writeJson(file, config);
  return { removed: before.length - config.shards.length };
}

// A committed project binding runs another plugin because someone edited a file, so it needs one confirmation per project and binding.
const confirmKey = (root, b) => sha(`${path.resolve(root)}|${b.step}|${b.ref}|${b.mode}|${b.kind}`);
// Confirming accepts the plugin as it is now: a project binding is allowed to run, and a changed one is pinned to its current content.
export function confirmProjectShards({ root, env = process.env, home = os.homedir() }) {
  const projectFile = configFile(root, env, true);
  const project = readJson(projectFile);
  const file = configFile(root, env, false);
  const global = readJson(file);
  const refresh = (b) => {
    if (!isBinding(b)) return b;
    const found = locate(b.ref, env, home);
    return found ? { ...b, kind: found.kind, version: found.version, sha256: sha(found.text) } : b;
  };
  const pinned = asList(project.shards).map(refresh);
  if (pinned.length > 0 && JSON.stringify(pinned) !== JSON.stringify(project.shards)) writeJson(projectFile, { ...project, shards: pinned });
  const keys = pinned.filter(isBinding).map((b) => confirmKey(root, b));
  writeJson(file, { ...global, shards: asList(global.shards).map(refresh), shard_confirmations: [...new Set([...asList(global.shard_confirmations), ...keys])] });
  return { confirmed: keys.length };
}

// Every binding with its current state: ok, changed, stale or unconfirmed.
export function listShards({ root, env = process.env, home = os.homedir() }) {
  const global = readJson(configFile(root, env, false));
  const project = readJson(configFile(root, env, true));
  const confirmed = new Set(asList(global.shard_confirmations));
  const inspect = (b, scope) => {
    if (!isBinding(b)) return { step: SHARD_STEPS.includes(b?.step) ? b.step : 'unknown', ref: '(invalid binding)', mode: 'read', scope, state: 'invalid' };
    if (scope === 'project' && !confirmed.has(confirmKey(root, b))) return { ...b, scope, state: 'unconfirmed' };
    let found = null;
    try { found = locate(b.ref, env, home); } catch { /* an unusable name counts as stale */ }
    if (!found) return { ...b, scope, state: 'stale' };
    return { ...b, scope, state: sha(found.text) === b.sha256 ? 'ok' : 'changed', current_version: found.version };
  };
  return [
    ...asList(global.shards).map((b) => inspect(b, 'global')),
    ...asList(project.shards).map((b) => inspect(b, 'project')),
  ];
}

export function shardsFor({ root, step, env = process.env, home = os.homedir() }) {
  const here = listShards({ root, env, home }).filter((b) => b.step === step);
  return {
    usable: here.filter((b) => b.state === 'ok' || (b.state === 'changed' && b.mode === 'read')),
    held: here.filter((b) => b.state === 'changed' && b.mode === 'write'),
    skipped: here.filter((b) => b.state === 'stale' || b.state === 'unconfirmed' || b.state === 'invalid'),
  };
}
