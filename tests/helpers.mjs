import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(REPO, 'scripts', 'somi.mjs');

// A private fixture repository with a fixed commit date, so its ids are the same on every run.
export function makeRepo(t, files = { 'src/app.js': 'export const one = 1;\n', '.gitignore': '.somi\n' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeFiles(dir, files);
  const env = { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...a) => execFileSync('git', a, { cwd: dir, env, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  return dir;
}

export function writeFiles(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}

export function somi(dir, args, { input, env = {} } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, input, encoding: 'utf8',
    env: { ...process.env, SOMI_GLOBAL_CONFIG: '', SOMI_CLOCK: '2026-01-02T00:00:00Z', SOMI_HOST: 'claude', ...env },
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* status and pr print text */ }
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr, json };
}

export const journalPath = (dir) => path.join(dir, '.somi', 'state', 'journal.jsonl');
export const journalText = (dir) => fs.readFileSync(journalPath(dir), 'utf8');
export const journal = (dir) => journalText(dir).split('\n').filter(Boolean).map((l) => JSON.parse(l));
