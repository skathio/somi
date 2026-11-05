// doctor.mjs: is the security boundary actually there? Reading settings is not proof, so the verdict comes from the vendor's own
// probes, run inside the agent's shell: writing to the home directory and reaching the network directly must both fail.
// Settings only add warnings about strictness. Run it from the agent, because a shell the user typed bypasses the sandbox.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveSpawn } from './tiers.mjs';

const WSL_REMEDY = 'Native Windows has no OS sandbox for agents. Run the agent inside WSL2 and run this again there.';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Later files win, as they do on Claude Code: user, then project, then local.
export function sandboxSettings({ host, root, home = os.homedir(), env = process.env }) {
  if (host === 'copilot') {
    const dir = env.COPILOT_HOME || path.join(home, '.copilot');
    return readJson(path.join(dir, 'settings.json'))?.sandbox ?? null;
  }
  const dir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const files = [path.join(dir, 'settings.json'), path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.local.json')];
  let merged = null;
  for (const f of files) {
    const s = readJson(f)?.sandbox;
    if (s && typeof s === 'object') merged = { ...merged, ...s };
  }
  return merged;
}

export function settingsWarnings(host, s) {
  if (!s || s.enabled !== true) return ['the sandbox is not enabled in settings'];
  const warnings = [];
  if (host === 'claude') {
    if (s.failIfUnavailable !== true) warnings.push('sandbox.failIfUnavailable is not true, so a missing sandbox silently runs commands unsandboxed');
    if (s.allowUnsandboxedCommands !== false) warnings.push('sandbox.allowUnsandboxedCommands is not false, so a command can retry outside the sandbox');
  } else {
    if (s.allowBypass !== false) warnings.push('sandbox.allowBypass is not false, so a command can ask to retry outside the sandbox (enforceable only through managed settings)');
    warnings.push('the Copilot CLI sandbox is in public preview and allows outbound internet by default; set host rules with /sandbox');
  }
  return warnings;
}

const defaultExec = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000 });

// A tier with no model runs on the session's, so its spend is not where the config says. Worth saying, not failing over.
export function tierWarnings(config, host) {
  const unmapped = ['low', 'medium', 'high'].filter((t) => !resolveSpawn(config, host, t).enforced);
  return unmapped.length ? [`no model is set for tier ${unmapped.join(', ')} on ${host}, so those workers run on the session's model; set them under tiers.${host} in config`] : [];
}

// Under Auto, Copilot CLI gives every subagent the model Auto chose and ignores the agent's own, so tiers do nothing there.
export function autoWarnings(host, { home = os.homedir(), env = process.env } = {}) {
  if (host !== 'copilot') return [];
  const model = env.COPILOT_MODEL || readJson(path.join(env.COPILOT_HOME || path.join(home, '.copilot'), 'settings.json'))?.model;
  return String(model ?? '').toLowerCase() === 'auto' ? ['the session model is Auto, so Copilot CLI ignores the model on every subagent and tiers do nothing; start with `somi setup`'] : [];
}

// A plugin's hooks can fail to load without any error. The audit hook runs on every tool call, so a log with nothing recent means none of them ran.
export function hookWarnings(root, { now = Date.now(), env = process.env } = {}) {
  const log = env.SOMI_AUDIT_LOG || path.join(root, '.somi', 'audit.log');
  try { if (now - fs.statSync(log).mtimeMs < 3600000) return []; } catch { /* no log is the same answer as an old one */ }
  return ['no hook has logged a tool call here in the last hour, so the tripwire hooks may not be running on this host; run this from inside an agent session, and on Copilot CLI try `somi init --host copilot`'];
}

export function runDoctor({ root, host, config = {}, platform = process.platform, env = process.env, home = os.homedir(), exec = defaultExec, removeFile = fs.rmSync, pid = process.pid }) {
  if (platform === 'win32') return { ok: false, verdict: 'FAIL', host, remedy: WSL_REMEDY, probes: [], warnings: [] };
  const probePath = path.join(home, `.somi-sandbox-probe-${pid}`);
  const touch = exec('touch', [probePath]);
  const curl = exec('curl', ['--noproxy', '*', '--silent', '--max-time', '8', '--output', '/dev/null', 'https://example.com']);
  if (touch.status === 0) { try { removeFile(probePath, { force: true }); } catch { /* the probe file is empty; the verdict stands */ } }
  const absent = (r) => r.error?.code === 'ENOENT';
  const probes = [
    { name: 'home-write', blocked: touch.status !== 0 && !absent(touch), detail: absent(touch) ? 'touch is not installed, so this was not verified' : undefined },
    { name: 'direct-network', blocked: curl.status !== 0 && !absent(curl), detail: absent(curl) ? 'curl is not installed, so this was not verified' : undefined },
  ];
  const ok = probes.every((p) => p.blocked);
  return {
    ok, verdict: ok ? 'PASS' : 'FAIL', host, probes,
    warnings: [...settingsWarnings(host, sandboxSettings({ host, root, home, env })), ...tierWarnings(config, host), ...autoWarnings(host, { home, env }), ...hookWarnings(root, { env })],
    remedy: ok ? undefined : 'Enable the sandbox (see `somi doctor --profile`), then run this from inside an agent session. Typing it at a `!` prompt usually bypasses the sandbox.',
  };
}
