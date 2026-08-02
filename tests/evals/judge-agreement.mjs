#!/usr/bin/env node
// Measures whether swapping the judge model changes any verdict, by re-scoring shards ALREADY on
// disk. No new agent runs -- the expensive half is already paid for.
//
// Exists because "the small model is cheaper" is not evidence that it grades the same. A judge
// that disagrees on 1 verdict in 20 moves a dimension a full grade at the N=20 bands, which would
// read as a definition-set regression in phase 4 when the only thing that changed was the scorer.
//
//   node tests/evals/judge-agreement.mjs <sha> [--a sonnet] [--b haiku]
//
// Reports per-criterion agreement. Anything below total agreement is a reason NOT to swap, or a
// reason to look at which criterion disagrees and why.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge, criterionTags } from './lib/score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const sha = args[0];
const modelA = args[args.indexOf('--a') + 1] ?? 'sonnet';
const modelB = args[args.indexOf('--b') + 1] ?? 'haiku';
if (!sha || sha.startsWith('--')) { process.stderr.write('usage: judge-agreement.mjs <sha> [--a M] [--b M]\n'); process.exit(2); }

const dir = join(HERE, 'results', sha);
if (!existsSync(dir)) { process.stderr.write(`no shards at ${dir}\n`); process.exit(2); }

const rows = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  if (rec.run.error || !rec.run.transcript) continue;
  const specDir = join(HERE, 'tasks');
  const specName = readdirSync(specDir).find((n) => n.startsWith(`${rec.taskId}-`));
  const spec = readFileSync(join(specDir, specName), 'utf8');
  const evidence = `### What the run returned\n\n${rec.run.transcript}`;

  const a = judge(spec, evidence, { model: modelA });
  const b = judge(spec, evidence, { model: modelB });
  if (!a.ok || !b.ok) { rows.push({ f, error: a.ok ? b.error : a.error }); continue; }

  const byN = (v) => Object.fromEntries(v.criteria.map((c) => [c.n, c.verdict]));
  const [va, vb] = [byN(a), byN(b)];
  const all = [...new Set([...Object.keys(va), ...Object.keys(vb)])];
  const disagree = all.filter((n) => va[n] !== vb[n]);
  rows.push({ f, total: all.length, disagree, va, vb });
}

let checked = 0, differed = 0;
for (const r of rows) {
  if (r.error) { process.stdout.write(`  ${r.f}: JUDGE ERROR ${r.error}\n`); continue; }
  checked += r.total;
  differed += r.disagree.length;
  const detail = r.disagree.map((n) => `c${n}: ${modelA}=${r.va[n]} ${modelB}=${r.vb[n]}`).join(', ');
  process.stdout.write(`  ${r.f}: ${r.total - r.disagree.length}/${r.total} agree${detail ? ` — ${detail}` : ''}\n`);
}
process.stdout.write(
  `\n  ${checked - differed}/${checked} criterion verdicts agree between ${modelA} and ${modelB}\n` +
  (differed === 0
    ? `  No disagreement. Swapping the judge is safe on this evidence.\n`
    : `  ${differed} disagreement(s). Do NOT swap without understanding each one: at N=20 a single\n` +
      `  flipped verdict in 20 moves a dimension a full grade, and phase 4 would read that as a\n` +
      `  definition-set regression when only the scorer changed.\n`));
