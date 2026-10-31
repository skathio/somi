// The sizing scorer: turns recorded sizing-probe rows into a result record bound to the labelled set (sizing-set.mjs),
// and says whether that record meets the bar, so no one computes it by hand.
//
// The bar, per entry over its N draws: the modal tier equals the label and the modal share is at least ceil(0.8 * N)
// (4 of 5); a floor case (`sensitive`) must match on all N draws. A tie for the mode has no modal tier and fails; a
// null tier (no tier recorded, or one outside the three) is a draw that matches no label. Two readings of the bar are
// always both reported: `per-task` (every entry passes) and `pooled` (at most one draw in ten off-label across the
// whole set, and every floor case still on all N draws); the option `mode` picks which one `bar_met` follows.
//
// A record is { label_sha256, plugin_sha, arm, entries: { id: [tier|null, ...] } }. Anything that would let two runs on
// different labels, arms or draw counts be read as one is refused with a thrown Refusal, never a verdict.
//
// CLI (exit codes are this tool's own; 64 and 65 belong to somi-tier and are never used):
//   --score <record.json> [--pooled] [--set <file>]    0 bar met, 3 bar missed, 2 refusal
//   --compare <base.json> <cand.json> [--pooled] [--set <file>]    0 comparable (the line says met or missed), 2 refusal
//   --build <rows.jsonl> --plugin-sha <sha> [--arm somi] [--set <file>]    prints a record; 0, or 2 on a refusal
// Exit 2 is only ever a Refusal (a usage error, a bad input, a bar that cannot be read); any other exception is a defect
// and exits 1 with its stack.
// Pure apart from the CLI's file reads; no network, no model.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ARMS } from './bench-schema.mjs';
import { TIERS, isFloorCase, labelHash, loadSet, scenarioId } from './sizing-set.mjs';

export class Refusal extends Error {}
const refuse = (msg) => { throw new Refusal(msg); };
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HARNESS_EVENTS = ['paused', 'over-budget'];
const SHA = /^[0-9a-f]{7,40}$/;
const HASH = /^[0-9a-f]{64}$/;
// Integer arithmetic, so 4/5 and 12/15 are exact: ceil(0.8 * n).
const needOf = (draws) => Math.ceil((draws * 4) / 5);
const allowedOff = (total) => Math.floor(total / 10);

// Sizing-phase rows ({scenario, arm, phase, tier}) to a record. Refuses a row outside the sizing phase, of another arm
// or for a scenario the set does not hold, a draw that ended on a harness event (paused, over budget) rather than an
// answer, an entry with no draw, and entries with different draw counts. A row without an `outcome` is taken as an
// answer; the probe's own `invalid` rows are answers too (the probe marks every sizing draw so).
export function buildResult(set, rows, { plugin_sha, arm }) {
  if (!SHA.test(plugin_sha ?? '')) refuse('plugin_sha must be 7 to 40 hex characters');
  if (!ARMS.includes(arm)) refuse(`arm must be one of ${ARMS.join(', ')}`);
  const entries = Object.fromEntries(set.entries.map((e) => [e.id, []]));
  const idOf = new Map(set.entries.map((e) => [scenarioId(e), e.id]));
  rows.forEach((r, i) => {
    if (!plain(r)) refuse(`row ${i} is not an object`);
    if (r.phase !== 'sizing') refuse(`row ${i} is in phase ${JSON.stringify(r.phase)}, not sizing`);
    if (r.arm !== arm) refuse(`row ${i} is for arm ${JSON.stringify(r.arm)}, not ${arm}`);
    if (!idOf.has(r.scenario)) refuse(`row ${i} names scenario ${JSON.stringify(r.scenario)}, which is not in the set`);
    if (HARNESS_EVENTS.includes(r.outcome)) refuse(`row ${i} (${r.scenario}) ended ${r.outcome}, not on an answer; draw it again`);
    entries[idOf.get(r.scenario)].push(TIERS.includes(r.tier) ? r.tier : null);
  });
  const counts = [...new Set(Object.values(entries).map((d) => d.length))];
  if (counts.length !== 1 || counts[0] === 0) refuse(`every entry needs the same number of draws (at least one); found ${counts.join(', ')}`);
  return { label_sha256: labelHash(set), plugin_sha, arm, entries };
}

// A record that is not shaped as above, or whose entries are not exactly the set's, is refused.
function checkRecord(set, rec, what) {
  if (!plain(rec) || !plain(rec.entries)) refuse(`${what} is not a result record`);
  if (!HASH.test(rec.label_sha256 ?? '')) refuse(`${what} has no label_sha256`);
  if (!SHA.test(rec.plugin_sha ?? '') || !ARMS.includes(rec.arm)) refuse(`${what} has a bad plugin_sha or arm`);
  const ids = set.entries.map((e) => e.id);
  const keys = Object.keys(rec.entries);
  if (keys.length !== ids.length || !ids.every((id) => Object.hasOwn(rec.entries, id))) refuse(`${what} does not hold exactly the set's entries`);
  const counts = new Set();
  for (const id of ids) {
    const d = rec.entries[id];
    if (!Array.isArray(d) || d.length === 0 || !d.every((t) => t === null || TIERS.includes(t))) refuse(`${what} entry ${id} is not a list of tiers or null`);
    counts.add(d.length);
  }
  if (counts.size !== 1) refuse(`${what} has entries with different draw counts`);
}

// The record was scored against this very set: the guard against comparing runs measured on different labels.
function bind(set, rec, what) {
  checkRecord(set, rec, what);
  if (rec.label_sha256 !== labelHash(set)) refuse(`${what} was scored against a different label set`);
}

// The most common tier of `draws` and its count; a tie for the top has no modal tier. Null is not a tier.
function modal(draws) {
  const n = new Map();
  for (const t of draws) if (t !== null) n.set(t, (n.get(t) ?? 0) + 1);
  const count = Math.max(0, ...n.values());
  const top = [...n].filter(([, c]) => c === count).map(([t]) => t);
  if (top.length !== 1) return { tier: null, count };
  return { tier: top[0], count };
}

export function scoreResult(set, rec, { mode = 'per-task' } = {}) {
  bind(set, rec, 'the record');
  if (mode !== 'per-task' && mode !== 'pooled') refuse(`unknown mode ${JSON.stringify(mode)}`);
  const entries = set.entries.map((e) => {
    const draws = rec.entries[e.id];
    const m = modal(draws);
    const floor = isFloorCase(e);
    const need = floor ? draws.length : needOf(draws.length);
    const off = draws.filter((t) => t !== e.label).length;
    return { id: e.id, label: e.label, floor, draws: draws.length, modal: m.tier, share: m.count / draws.length, need, off, pass: m.tier === e.label && m.count >= need };
  });
  const total = entries.reduce((s, x) => s + x.draws, 0);
  const off = entries.reduce((s, x) => s + x.off, 0);
  const perTaskMet = entries.every((x) => x.pass);
  const pooledMet = off <= allowedOff(total) && entries.every((x) => !x.floor || x.off === 0);
  return {
    label_sha256: rec.label_sha256, plugin_sha: rec.plugin_sha, arm: rec.arm, mode, entries,
    pooled: { off, total, allowed: allowedOff(total) }, per_task: { passing: entries.filter((x) => x.pass).length, total: entries.length },
    bar_met: mode === 'pooled' ? pooledMet : perTaskMet,
  };
}

// Both records, scored side by side; a refusal (thrown) when either was not scored against this set or they differ.
export function compareResults(set, baseline, candidate, opts) {
  checkRecord(set, baseline, 'the baseline');
  checkRecord(set, candidate, 'the candidate');
  if (baseline.label_sha256 !== candidate.label_sha256) refuse('the baseline and the candidate were scored against different label sets');
  return { baseline: scoreResult(set, baseline, opts), candidate: scoreResult(set, candidate, opts) };
}

export function verdictLine(s) {
  const bad = s.entries.filter((x) => !x.pass).map((x) => x.id);
  const head = s.bar_met ? `sizing bar met (${s.mode})` : `sizing bar missed (${s.mode}): disagrees on ${bad.join(', ') || 'off-label draws only'}`;
  return `${head}; ${s.per_task.passing}/${s.per_task.total} entries pass; ${s.pooled.off}/${s.pooled.total} draws off-label (allowed ${s.pooled.allowed}); arm ${s.arm}; plugin ${s.plugin_sha}; labels ${s.label_sha256.slice(0, 12)}`;
}

// ---- command line ------------------------------------------------------------------------------------------------

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return refuse(`cannot read ${f}: ${e.message}`); } };
const readJson = (f) => { try { return JSON.parse(readText(f)); } catch (e) { return e instanceof Refusal ? refuse(e.message) : refuse(`${f} is not JSON: ${e.message}`); } };
const USAGE = 'usage: sizing-score.mjs --score <record.json> | --compare <base.json> <cand.json> | --build <rows.jsonl> --plugin-sha <sha> [--arm somi]  [--pooled] [--set <file>]';
const FLAGS_WITH_VALUE = ['--set', '--plugin-sha', '--arm'];

// A results.jsonl line is one entry ({status, row}); a bare row is taken as it is. A line that is not JSON names its number.
function rowsOf(file) {
  const lines = readText(file).split('\n').map((text, i) => ({ text, n: i + 1 })).filter((l) => l.text.trim() !== '').map(({ text, n }) => {
    try { return JSON.parse(text); } catch (e) { return refuse(`${file} line ${n} is not JSON: ${e.message}`); }
  });
  return lines.filter((l) => !plain(l) || !('status' in l) || l.status === 'done').map((l) => (plain(l) && l.row !== undefined ? l.row : l));
}

function main(argv) {
  const opts = { mode: 'per-task' }; const pos = []; const val = {}; let cmd = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--score' || a === '--compare' || a === '--build') cmd = a;
    else if (a === '--pooled') opts.mode = 'pooled';
    else if (FLAGS_WITH_VALUE.includes(a)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) refuse(`${a} needs a value\n${USAGE}`);
      val[a] = argv[++i];
    } else if (a.startsWith('--')) refuse(`unknown flag ${a}`);
    else pos.push(a);
  }
  if (cmd === null || pos.length !== (cmd === '--compare' ? 2 : 1)) refuse(USAGE);
  let set;
  try { set = val['--set'] ? loadSet(val['--set']) : loadSet(); } catch (e) { return refuse(e.message); }
  if (cmd === '--build') {
    console.log(JSON.stringify(buildResult(set, rowsOf(pos[0]), { plugin_sha: val['--plugin-sha'], arm: val['--arm'] ?? 'somi' }), null, 2));
    return 0;
  }
  if (cmd === '--score') {
    const s = scoreResult(set, readJson(pos[0]), opts);
    console.log(verdictLine(s));
    return s.bar_met ? 0 : 3;
  }
  const c = compareResults(set, readJson(pos[0]), readJson(pos[1]), opts);
  console.log(`baseline: ${verdictLine(c.baseline)}\ncandidate: ${verdictLine(c.candidate)}`);
  return 0;
}

// Only a Refusal is a refusal (exit 2). Anything else is a defect in this tool or its environment: it surfaces as an error.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) {
    if (e instanceof Refusal) { process.stderr.write(`sizing-score: refused: ${e.message}\n`); process.exitCode = 2; } else {
      process.stderr.write(`sizing-score: error: ${e.stack ?? e}\n`);
      process.exitCode = 1;
    }
  }
}
