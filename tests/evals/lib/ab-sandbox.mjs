// The draw's sandbox and the plugin it runs: the bubblewrap command line a draw is launched through, and the read-only private copy of the
// packed plugin each arm loads. No model call, no network.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lstatManifest } from './manifest.mjs';

// ---- sandbox --------------------------------------------------------------------------------------------------

const under = (p, dir) => p === dir || p.startsWith(`${dir}/`);
/** Absolute real path of a command (looked up in PATH when it has no slash), or null. */
export function resolveBinary(name) {
  const cands = name.includes('/') ? [path.resolve(name)] : (process.env.PATH ?? '').split(':').filter(Boolean).map((d) => path.join(d, name));
  for (const c of cands) { try { const r = fs.realpathSync(c); if (fs.statSync(r).isFile()) return r; } catch { /* next */ } }
  return null;
}
/** The bubblewrap command line (without the program name) running `command argv` in the sandbox described by `spec`. */
export function sandboxArgs(spec, command, argv) {
  const a = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', spec.home, '--tmpfs', '/tmp'];
  if (!under(spec.repoRoot, spec.home) && !under(spec.repoRoot, '/tmp')) a.push('--tmpfs', spec.repoRoot);
  for (const p of spec.ro) a.push('--ro-bind', p, p);
  for (const p of spec.rw) a.push('--bind', p, p);
  return [...a, '--unshare-pid', '--die-with-parent', '--new-session', '--share-net', '--', command, ...argv];
}
/** The spec for one run: the claude binary's directory and every PATH directory under HOME, read-only; `rw` per draw. */
export function sandboxSpec({ home, repoRoot, claudeReal, plugin }) {
  const ro = new Set([path.dirname(claudeReal)]);
  for (const d of (process.env.PATH ?? '').split(':').filter(Boolean)) { try { const r = fs.realpathSync(d); if (under(r, home)) ro.add(r); } catch { /* absent */ } }
  if (plugin) ro.add(plugin);
  return { home, repoRoot, ro: [...ro].filter((p) => fs.existsSync(p)) };
}
/** True when bubblewrap runs a harmless command with this spec. */
export const probeSandbox = (spec) => spawnSync('bwrap', sandboxArgs({ ...spec, rw: [] }, 'true', []), { stdio: 'ignore', timeout: 10000 }).status === 0;

// ---- plugin ----------------------------------------------------------------------------------------------------

/** `npm pack` the repository into `runTmp` and extract it read-only -> the plugin directory. Throws on any doubt. */
export function buildPlugin({ repoRoot, runTmp, dirName = 'plugin', patches = [] }) {
  const env = { PATH: process.env.PATH ?? '', HOME: runTmp, npm_config_cache: path.join(runTmp, 'npm-cache'), npm_config_update_notifier: 'false' };
  const pack = spawnSync('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', runTmp], { cwd: repoRoot, env, encoding: 'utf8', timeout: 120000 });
  const name = (pack.stdout ?? '').trim().split('\n').pop();
  if (pack.status !== 0 || !/^[A-Za-z0-9._@-]+\.tgz$/.test(name)) throw new Error('npm pack failed');
  const dest = path.join(runTmp, dirName);
  fs.mkdirSync(dest, { mode: 0o700 });
  const tar = spawnSync('tar', ['-xzf', path.join(runTmp, name), '-C', dest, '--strip-components=1', '--no-same-owner'], { stdio: 'ignore', timeout: 60000 });
  if (tar.status !== 0) throw new Error('extracting the package failed');
  const m = lstatManifest(dest);
  if (!m?.ok || m.files.some(([p]) => p.startsWith('tests/evals/') || p.startsWith('.somi/') || p.includes('/manual/'))) throw new Error('the packed plugin holds files that must not ship');
  // An ablation edits this private copy only, so the shipped plugin has no switch for turning a part off. A patch that no longer
  // matches exactly once stops the recording instead of quietly measuring the full plugin.
  for (const { file, find, replace } of patches) {
    const target = path.join(dest, file);
    const text = fs.readFileSync(target, 'utf8');
    if (text.split(find).length !== 2) throw new Error(`the ablation patch for ${file} does not match exactly once`);
    fs.writeFileSync(target, text.replace(find, () => replace));
  }
  const lock = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) lock(p); else fs.chmodSync(p, fs.statSync(p).mode & 0o111 ? 0o500 : 0o400); } fs.chmodSync(d, 0o500); };
  lock(dest);
  return dest;
}
