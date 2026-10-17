#!/usr/bin/env node
// hooks/session-start/ensure-default-config.mjs — SessionStart hook — create a default
// .somi/config.json when the project has none.
//
// Without a config every agent runs at the built-in default ceiling, so the agents built for the
// strongest tier (reviewers, designer, security-reviewer, ...) would silently run lower. The default
// file pins each agent to the highest tier it declares and sets the ceiling; see
// scripts/lib/cost-defaults.mjs for the table and the exact text this hook writes.
//
// Guarantees (a project's own files are untrusted, and a hook must never block a session):
//   - Acts only when NOTHING exists at <root>/.somi/config.json (lstat ENOENT). An existing file of
//     any kind — valid, invalid JSON, a symlink (even dangling), a directory — is left untouched.
//   - `.somi` must be a real directory (lstat) or absent; a symlink or file there writes nothing.
//     It is created with mode 0700 only when absent.
//   - The file is created with O_CREAT|O_EXCL|O_NOFOLLOW, so a race or a planted link at the path
//     can never be written through. Nothing else is written anywhere.
//   - The content is a fixed constant, never derived from any existing file.
//   - Exit code is 0 on every path; no file content or error text is printed. On success it prints
//     one short, fixed notice through the same SessionStart channel the sibling hook uses.
//   - When a regular config file already exists, it is only READ (O_NOFOLLOW, at most 64 KiB): if it
//     parses to an object with no own cost.agents["security-reviewer"] tier, or one pinned below high,
//     one fixed notice says so (a distinct text for each).
//     Nothing from the file reaches the notice, and the file is never written.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { projectRoot, contextOutput, runHook } from '../lib/common.mjs';

const DEFAULTS_LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'lib', 'cost-defaults.mjs');
const CREATE = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);

const MAX_READ = 64 * 1024;
const READ = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
const LOW_PIN_NOTICE = 'SoMi: .somi/config.json pins security-reviewer below high; its security reviews run at that lower tier.';
const PIN_NOTICE = 'SoMi: .somi/config.json has no cost.agents pin for security-reviewer, so it runs at the ceiling (below high by default). Pin it under cost.agents to keep the strong pass.';

function writeAll(fd, text) {
  const buf = Buffer.from(text);
  for (let off = 0; off < buf.length;) off += fs.writeSync(fd, buf, off, buf.length - off);
}

// For a config that parses to an object: 'missing' when it has no own, valid-tier
// cost.agents["security-reviewer"], 'low' when that entry is below high, else null. Any doubt
// (symlink, not a regular file, oversize, unparsable) is null: the resolver reports those.
function securityPinState(file) {
  let fd;
  try {
    fd = fs.openSync(file, READ);
    if (!fs.fstatSync(fd).isFile()) return null;
    const buf = Buffer.alloc(MAX_READ + 1);
    let n = 0;
    while (n < buf.length) {
      const got = fs.readSync(fd, buf, n, buf.length - n, null);
      if (got === 0) break;
      n += got;
    }
    if (n > MAX_READ) return null;
    const cfg = JSON.parse(buf.toString('utf8', 0, n));
    if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
    const agents = cfg.cost && typeof cfg.cost === 'object' ? cfg.cost.agents : undefined;
    const tier = agents && typeof agents === 'object' && Object.hasOwn(agents, 'security-reviewer') ? agents['security-reviewer'] : undefined;
    if (tier === 'low' || tier === 'medium') return 'low';
    return tier === 'high' ? null : 'missing';
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
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
    const dir = lstatOrNull(somi);
    if (dir && !dir.isDirectory()) return; // a symlink or a file: write nothing
    const existing = dir ? lstatOrNull(file) : null;
    if (existing) { // anything already there is left alone; a regular file is only read
      const pin = existing.isFile() ? securityPinState(file) : null;
      if (pin) contextOutput('SessionStart', pin === 'low' ? LOW_PIN_NOTICE : PIN_NOTICE);
      return;
    }
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
    contextOutput('SessionStart', `SoMi created .somi/config.json with default cost settings: ceiling ${ceiling}, each agent pinned to its default tier. Edit "cost" in .somi/config.json to change them.`);
  } catch {
    // Any failure (read-only directory, EEXIST race, missing plugin file) is a silent no-op.
  }
}

runHook(() => main().then(() => { process.exitCode = 0; }));
