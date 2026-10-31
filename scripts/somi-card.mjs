#!/usr/bin/env node
// somi-card.mjs -- prints the run card for one code iteration (scripts/lib/run-card.mjs), for the orchestrator to
// paste, unchanged, at the top of every agent briefing in one code-review loop.
//
// Usage: node somi-card.mjs --slug <slug> --iteration <N.M> --host <claude-code|copilot>
// Reads .somi/somi-state/loop/<slug>.<N.M>.json under the project (CLAUDE_PROJECT_DIR, else the current directory),
// so run it after `somi-loop.mjs init`. Exit 0 with the card on stdout; 64 on a usage error or a missing loop state.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCard, SLUG_RE, ITERATION_RE } from './lib/run-card.mjs';

const usage = 'usage: somi-card.mjs --slug <slug> --iteration <N.M> --host <claude-code|copilot>';
const die = (msg) => { process.stderr.write(`somi-card: ${msg}\n${usage}\n`); process.exit(64); };

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const k = argv[i];
  if (!['--slug', '--iteration', '--host'].includes(k) || argv[i + 1] === undefined) die(`unexpected argument ${JSON.stringify(k)}`);
  args[k.slice(2)] = argv[i + 1];
}
if (!SLUG_RE.test(args.slug ?? '') || !ITERATION_RE.test(args.iteration ?? '')) die('--slug and --iteration are required and must be well formed');

let projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (projectDir.includes('${')) projectDir = process.cwd();
projectDir = path.resolve(projectDir);
const somiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let state = null;
try {
  state = JSON.parse(fs.readFileSync(path.join(projectDir, '.somi', 'somi-state', 'loop', `${args.slug}.${args.iteration}.json`), 'utf8'));
} catch {
  die(`no loop state for ${args.slug} ${args.iteration}: run somi-loop init first`);
}
const r = buildCard({ slug: args.slug, iteration: args.iteration, host: args.host, projectDir, somiRoot, state });
if (!r.ok) die(r.error);
process.stdout.write(r.card);
