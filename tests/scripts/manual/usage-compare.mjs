#!/usr/bin/env node
// Compares two usage-speed baselines under the registered rule.
//   node tests/scripts/manual/usage-compare.mjs <baselineA.json> <baselineB.json> --primary <metric> [--draft]
// A is the candidate, B the baseline. Exit 0 verdict printed, 64 usage error or refusal, 65 invalid input.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRule } from '../../evals/lib/bench-rule.mjs';
import { verdict } from '../../evals/lib/bench-verdict.mjs';

export const LIMITS = `LIMITS (what this comparison can and cannot conclude)
  - Tier: every verdict is for the recorded model tier only (low). Direction transfers for context-size changes;
    Stage -1 sizing and other model-behaviour effects do not transfer to a higher tier.
  - L0 is exact bytes injected, not tokens billed. L1 is local latency on one host fingerprint. L2 resolves only
    30% in time and 20% in cost, tokens or turns at 8 repeats per arm; smaller changes read inconclusive by design.
  - Quality: only a coarse non-inferiority flag (0.20 median drop, 0.25 more invalid or zero draws). No quality win
    or loss is declared, and a drop under about 0.20 is not detected.
  - L1 and wall time are refused across hosts or after a model alias change; re-record instead.
  - A release comparison conflates every change in the release; only the named primary metric can headline.`;

const usage = 'usage: usage-compare.mjs <candidate.json> <baseline.json> --primary <metric> [--draft]';
const fmt = (x) => (typeof x === 'number' ? x.toFixed(4) : '-');

function parse(argv) {
  const files = []; let primary; let draft = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--primary') primary = argv[++i];
    else if (argv[i] === '--draft') draft = true;
    else if (argv[i].startsWith('--')) return null;
    else files.push(argv[i]);
  }
  return files.length === 2 && primary ? { files, primary, draft } : null;
}

function main(argv) {
  const a = parse(argv);
  if (!a) { console.error(usage); return 64; }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const rule = loadRule();
  if (!rule) { console.error('invalid input: the rule file could not be loaded'); return 65; }
  const docs = [];
  for (const f of a.files) {
    try { docs.push(JSON.parse(readFileSync(f, 'utf8'))); } catch { console.error(`invalid input: cannot read or parse ${f}`); return 65; }
  }
  const r = verdict(docs[0], docs[1], rule, { primaryMetric: a.primary, draft: a.draft, repoRoot: root });
  console.log(`rule hash: ${rule.hash} (version ${rule.rule.version}, ${rule.sealed ? 'sealed' : 'UNSEALED'})`);
  if (r.refused) { console.log(`REFUSED: ${r.refused}`); console.log(LIMITS); return r.code === 'invalid-input' ? 65 : 64; }
  if (r.draft) console.log('DRAFT: the rule is unsealed; this result is not a registered verdict');
  console.log(`candidate ${r.candidateSha}  baseline ${r.baselineSha}  tier ${r.tier}  alias ${r.alias}`);
  console.log(`primary metric: ${r.primaryMetric}`);
  console.log('metric   layer role       basis     ratio    lower    upper    min    status');
  for (const m of [...r.metrics, ...(r.secondary ? [r.secondary] : [])]) {
    console.log(`${m.metric.padEnd(8)} ${m.layer.padEnd(5)} ${m.role.padEnd(10)} ${m.basis.padEnd(9)} ${fmt(m.estimate)}   ${fmt(m.lower)}   ${fmt(m.upper)}   ${fmt(m.minEffect)}  ${m.status}${m.note ? ` (${m.note})` : ''}`);
  }
  if (r.guard) console.log(`quality guard: ${r.guard.tripped ? 'TRIPPED' : 'clear'}  ${JSON.stringify(r.guard.scenarios)}`);
  if (r.draws) console.log(`draws: ${JSON.stringify(r.draws)}`);
  console.log(`VERDICT: ${r.verdict}${r.draft ? ' (DRAFT)' : ''}`);
  console.log(LIMITS);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
