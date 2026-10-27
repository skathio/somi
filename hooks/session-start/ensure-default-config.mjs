#!/usr/bin/env node
// hooks/session-start/ensure-default-config.mjs — SessionStart hook — create a default
// .somi/config.json when the project has none.
//
// Without a config every agent runs at the built-in default ceiling, so the agents built for the
// strongest tier (reviewers, designer, security-reviewer, ...) would silently run lower. The default
// file pins each agent to the highest tier it declares and sets the ceiling; see
// scripts/lib/cost-defaults.mjs for the table and the exact text this hook writes.
//
// With a global config (scripts/lib/config-files.mjs), that file already supplies the defaults, and a
// fully pinned project file would mask every one of its values, so nothing is written.
//
// Guarantees (a project's own files are untrusted, and a hook must never block a session):
//   - Acts only when NOTHING exists at <root>/.somi/config.json (lstat ENOENT) and no global config
//     file exists. An existing file of any kind — valid, invalid JSON, a symlink (even dangling), a
//     directory — is left untouched.
//   - `.somi` must be a real directory (lstat) or absent; a symlink or file there writes nothing.
//     It is created with mode 0700 only when absent.
//   - The file is created with O_CREAT|O_EXCL|O_NOFOLLOW, so a race or a planted link at the path
//     can never be written through. Nothing else is written anywhere.
//   - The content is a fixed constant, never derived from any existing file.
//   - Exit code is 0 on every path; no file content or error text is printed. On success it prints
//     one short, fixed notice through the same SessionStart channel the sibling hook uses.
//   - When a config file already exists (project or global), the effective config is only READ,
//     through the shared loader (links followed, regular files of at most 64 KiB): if it has no
//     cost.agents["somi-security-reviewer"] tier, or one below high, one fixed notice says so (a distinct
//     text for each, naming the global config when there is one). An unreadable or invalid config prints
//     nothing (the resolver reports it). Nothing from a file reaches the notice, and no file is written.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { projectRoot, contextOutput, runHook } from '../lib/common.mjs';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'lib');
const DEFAULTS_LIB = path.join(LIB, 'cost-defaults.mjs');
const CONFIG_LIB = path.join(LIB, 'config-files.mjs');
const CREATE = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);
const LOW_PIN_NOTICE = 'SoMi: .somi/config.json pins somi-security-reviewer below high; its security reviews run at that lower tier.';
const PIN_NOTICE = 'SoMi: .somi/config.json has no cost.agents pin for somi-security-reviewer, so it runs at the ceiling (below high by default). Pin it under cost.agents to keep the strong pass.';
const GLOBAL_LOW_PIN_NOTICE = 'SoMi: the SoMi config (your global config, with any .somi/config.json over it) pins somi-security-reviewer below high; its security reviews run at that lower tier.';
const GLOBAL_PIN_NOTICE = 'SoMi: the SoMi config (your global config, with any .somi/config.json over it) has no cost.agents pin for somi-security-reviewer, so it runs at the ceiling (below high by default). Pin it under cost.agents to keep the strong pass.';

function writeAll(fd, text) {
  const buf = Buffer.from(text);
  for (let off = 0; off < buf.length;) off += fs.writeSync(fd, buf, off, buf.length - off);
}

// For the effective config: 'missing' when it has no own, valid-tier cost.agents["somi-security-reviewer"],
// 'low' when that entry is below high, else null.
function securityPinState(cfg) {
  const agents = cfg.cost && typeof cfg.cost === 'object' ? cfg.cost.agents : undefined;
  const tier = agents && typeof agents === 'object' && Object.hasOwn(agents, 'somi-security-reviewer') ? agents['somi-security-reviewer'] : undefined;
  if (tier === 'low' || tier === 'medium') return 'low';
  return tier === 'high' ? null : 'missing';
}

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

async function main() {
  try {
    const root = projectRoot();
    if (!fs.statSync(root).isDirectory()) return;
    const somi = path.join(root, '.somi');
    const file = path.join(somi, 'config.json');
    const { loadConfig, globalConfigPath } = await import(pathToFileURL(CONFIG_LIB).href);
    const globalFile = globalConfigPath();
    const hasGlobal = globalFile !== null && lstatOrNull(globalFile) !== null;
    const dir = lstatOrNull(somi);
    const existing = lstatOrNull(file); // through a linked .somi too: reads follow links
    if (existing || hasGlobal) { // a config exists: it is only read, never written
      let files = null;
      try { files = loadConfig(root); } catch { /* the resolver reports an unreadable config */ }
      const pin = files && (files.project.present || files.global.present) ? securityPinState(files.config) : null;
      if (pin === 'low') contextOutput('SessionStart', hasGlobal ? GLOBAL_LOW_PIN_NOTICE : LOW_PIN_NOTICE);
      else if (pin) contextOutput('SessionStart', hasGlobal ? GLOBAL_PIN_NOTICE : PIN_NOTICE);
      return;
    }
    if (dir && !dir.isDirectory()) return; // a symlinked .somi or a file: write nothing
    const { serializeDefaultConfig, buildDefaultConfig } = await import(pathToFileURL(DEFAULTS_LIB).href);
    const text = serializeDefaultConfig();
    const ceiling = buildDefaultConfig().cost.ceiling;
    if (!dir) {
      try {
        fs.mkdirSync(somi, { mode: 0o700 });
      } catch (e) {
        if (e.code !== 'EEXIST') return;
        if (!lstatOrNull(somi)?.isDirectory()) return; // lost a race to a link or a file
      }
    }
    const fd = fs.openSync(file, CREATE, 0o644);
    try {
      writeAll(fd, text);
    } catch {
      // We created it a moment ago; do not leave half a file, but never remove a swapped path.
      try {
        const mine = fs.fstatSync(fd);
        const now = lstatOrNull(file);
        if (now && now.dev === mine.dev && now.ino === mine.ino) fs.rmSync(file, { force: true });
      } catch { /* leave it */ }
      fs.closeSync(fd);
      return;
    }
    fs.closeSync(fd);
    contextOutput('SessionStart', `SoMi created .somi/config.json with default cost settings: ceiling ${ceiling}, each agent pinned to its default tier. Run /somi-config, or edit "cost" in .somi/config.json, to change them.`);
  } catch {
    // Any failure (read-only directory, EEXIST race, missing plugin file) is a silent no-op.
  }
}

runHook(() => main().then(() => { process.exitCode = 0; }));
