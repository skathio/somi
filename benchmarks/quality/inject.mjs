#!/usr/bin/env node
// How often the quality gate catches what it is for. In a throwaway clone of a known-good repository it adds one known smell at a time
// to a source file, runs the gate on that change, and records whether the expected rule fired. Each smell starts from a clean HEAD.
//   node benchmarks/quality/inject.mjs <repo> [--files 10]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { TEST_FILE } from '../../scripts/lib/signals.mjs';
import { listFiles, snapshotTree } from '../../scripts/lib/git-tree.mjs';
import { qualityGate } from '../../scripts/lib/quality/gate.mjs';
import { DEFAULT_LIMITS } from '../../scripts/lib/quality/limits.mjs';
import { unitsOf } from '../../scripts/lib/quality/metrics.mjs';
import { languageOf, parseSource } from '../../scripts/lib/quality/parse.mjs';

// The same folders the gate skips, so a smell is only ever injected where the gate looks.
const SKIPPED = /(^|\/)(node_modules|vendor|dist|build|coverage|fixtures?|__fixtures__|testdata|test-data|docs?|examples?|demos?|playgrounds?)\/|\.min\.js$|\.d\.ts$|config\./;
const lines = (n, body) => Array.from({ length: n }, (_, i) => body(i)).join('\n');
const SMELLS = {
  pyramid: { rule: 'depth', text: () => 'export function somiInjectedPyramid(items, a, b) {\n  for (const x of items) {\n    for (const y of x.children) {\n      if (a) { if (b) { if (y.ok) { return y; } } }\n    }\n  }\n  return null;\n}\n' },
  long: { rule: 'lines', text: () => `export function somiInjectedLong(input) {\n  const out = [];\n${lines(70, (i) => `  out.push(input.value${i} ?? ${i});`)}\n  return out;\n}\n` },
  params: { rule: 'params', text: () => 'export function somiInjectedParams(a, b, c, d, e, f) {\n  return [a, b, c, d, e, f].filter(Boolean);\n}\n' },
  suppression: { rule: 'suppression', text: () => '// eslint-disable-next-line no-console\nconsole.log("somi injected");\n' },
  split: { rule: 'file-added-cognitive', text: () => lines(5, (i) => `export function somiInjectedPart${i}(a, b, c) {\n  if (a) { if (b) { if (c) { return ${i}; } } }\n  return -1;\n}`) + '\n' },
  clone: { rule: 'clone', text: (donor) => donor },
};

const { values, positionals } = parseArgs({ allowPositionals: true, options: { files: { type: 'string' }, 'clone-tokens': { type: 'string' } } });
const limits = values['clone-tokens'] ? { ...DEFAULT_LIMITS, clones: { tokens: Number(values['clone-tokens']) } } : DEFAULT_LIMITS;
const source = path.resolve(positionals[0]);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-inject-'));
const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }).trim();
try {
  execFileSync('git', ['clone', '-q', '--local', '--no-hardlinks', source, dir], { stdio: 'ignore' });
  const head = git('rev-parse', 'HEAD');
  const all = listFiles(dir, head).filter((f) => ['javascript', 'typescript'].includes(languageOf(f)) && !TEST_FILE.test(f) && !SKIPPED.test(f));
  const step = Math.max(1, Math.floor(all.length / Number(values.files ?? 10)));
  const targets = all.filter((_, i) => i % step === 0).slice(0, Number(values.files ?? 10));
  // The donor for the copy is the largest function elsewhere in the repository that is valid code on its own, renamed, so it is a copy
  // and not the same declaration. A method or an arrow cut out of its surroundings does not parse alone, so the next one is tried.
  const donorFor = async (target) => {
    const candidates = [];
    for (const f of all.filter((x) => x !== target).slice(0, 200)) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const parsed = await parseSource(f, text);
      for (const u of parsed?.tree ? unitsOf(parsed.tree, { file: f }) : []) if (u.lines >= 12 && u.lines <= 60) candidates.push({ ...u, text: text.split('\n').slice(u.start - 1, u.end).join('\n') });
      parsed?.tree?.delete();
    }
    for (const c of candidates.sort((a, b) => b.lines - a.lines)) {
      const alone = await parseSource('donor.ts', c.text);
      const ok = Boolean(alone?.tree) && alone.errors.length === 0;
      alone?.tree?.delete();
      if (ok) return `\n${c.text.replace(c.name, 'somiInjectedCopy')}\n`;
    }
    return null;
  };
  const results = [];
  for (const file of targets) {
    const donor = await donorFor(file);
    for (const [name, smell] of Object.entries(SMELLS)) {
      if (name === 'clone' && !donor) continue;
      git('checkout', '-q', '--', '.');
      fs.appendFileSync(path.join(dir, file), `\n${smell.text(donor)}`);
      const r = await qualityGate(dir, { from: head, to: snapshotTree(dir), limits, repoFiles: listFiles(dir, head) });
      results.push({ file, smell: name, caught: r.violations.some((v) => v.rule === smell.rule), rules: [...new Set(r.violations.map((v) => v.rule))] });
    }
  }
  const by = {};
  for (const x of results) { by[x.smell] ??= { injected: 0, caught: 0 }; by[x.smell].injected += 1; by[x.smell].caught += x.caught ? 1 : 0; }
  process.stdout.write(`${JSON.stringify({ repo: path.basename(source), files: targets.length, by, missed: results.filter((x) => !x.caught) })}\n`);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
