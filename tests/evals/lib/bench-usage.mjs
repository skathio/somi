// Usage parsing and run bookkeeping for the usage and speed benchmark's two-arm driver
// (tests/scripts/manual/usage-bench.mjs). Pure apart from reading one kept stream file: no model call, no network.
//
// parseStream(file) reads a kept stream.jsonl, which is data a model session produced: bounded in size and in line
// length, one JSON.parse per line inside a try, own-property reads only. Result lines (type "result") give cost, turns
// and per-model token classes from `modelUsage` (inputTokens, outputTokens, cacheReadInputTokens,
// cacheCreationInputTokens), summed over every invocation of the draw (a resume is another result line). Only assistant
// events count tool_use blocks (a block repeated under one id counts once); a tool_use shape inside a user event, a
// tool result or a string is not a tool call. `subagents` counts the blocks named Agent or Task. It returns null when
// the file is unusable (missing, over the size cap, or without any result line); it never throws.
//
// isPinned(id, alias, extra): a model id is pinned when it IS the alias or an extra id, or contains the alias as a whole
// word between non-alphanumeric characters (alias "x" matches "vendor-x-1-2024"). The driver knows no model names.
//
// toRow(draw, parsed, score, tierInfo) -> {row, reason}. `row` has exactly the keys rowProblems (bench-schema) accepts and
// always validates; `reason` is the vocabulary of the draw's outcome, kept beside the row because the row has no such
// field. A model other than the pinned set (or no model information at all) makes the row invalid; so does a scored
// outcome without a hidden-suite score.
//
// Plan and results: buildPlan makes the ordered draw list (rounds of one pair per scenario, the pair's two arms back to back,
// order and arm order shuffled with seeds derived from the plan seed, so any prefix of the run stays balanced); planMismatch names the fields in which a
// stored plan differs from a recomputed one; parseResults reads results.jsonl text as untrusted and refuses (never skips)
// a torn, unparsable or implausible line; pendingDraws returns the draws without a terminal entry. An entry's status is
// `done` (a validated row) or `halted` (HALT_REASONS: not a result, no row; the draw is re-run later, and its cost still counts).

import fs from 'node:fs';
import { rowProblems, ARMS, TOKEN_CLASSES } from './bench-schema.mjs';
import { seededShuffle } from './ab-draw.mjs';

export const MAX_STREAM_FILE = 96 * 1024 * 1024;
export const MAX_LINE = 16 * 1024 * 1024;
const CHUNK = 1024 * 1024;
const MAX_BLOCKS = 20000;
const MAX_IDS = 200000;
const MAX_MODELS = 64;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const CLASS_KEYS = { input: 'inputTokens', output: 'outputTokens', cacheRead: 'cacheReadInputTokens', cacheCreation: 'cacheCreationInputTokens' };
export const HALT_REASONS = ['account-limit', 'bg-wait-ceiling', 'auth', 'budget-stop', 'harness-fault', 'interrupted', 'no-result', 'spawn-error'];
export const TIER_NAMES = ['small', 'trivial', 'full', 'unknown'];

const own = (o, k) => (o !== null && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined);
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (x, max = 1e12) => (Number.isSafeInteger(x) && x >= 0 ? Math.min(x, max) : 0);

/** Lines of a file in bounded chunks: [line | null] where null stands for one line over `maxLine`. Throws on a read fault. */
function* lines(fd, maxLine) {
  const buf = Buffer.allocUnsafe(CHUNK);
  let carry = []; let size = 0; let over = false;
  for (let n = fs.readSync(fd, buf, 0, CHUNK, null); n > 0; n = fs.readSync(fd, buf, 0, CHUNK, null)) {
    let from = 0;
    for (let i = buf.indexOf(10); i >= 0 && i < n; i = buf.indexOf(10, from)) {
      if (!over) { carry.push(Buffer.from(buf.subarray(from, i))); size += i - from; }
      yield over || size > maxLine ? null : Buffer.concat(carry).toString('utf8');
      carry = []; size = 0; over = false; from = i + 1;
    }
    if (!over) { carry.push(Buffer.from(buf.subarray(from, n))); size += n - from; if (size > maxLine) { over = true; carry = []; } }
  }
  if (over) yield null; else if (size > 0) yield Buffer.concat(carry).toString('utf8');
}

export function parseStream(file, { maxBytes = MAX_STREAM_FILE, maxLine = MAX_LINE } = {}) {
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > maxBytes) return null;
    const tokens = new Map(); const seen = new Set(); const ids = new Set();
    const out = { toolCalls: 0, subagents: 0, turns: 0, costUsd: 0, results: 0, skipped: 0, modelsTruncated: false };
    for (const raw of lines(fd, maxLine)) {
      if (raw === null) { out.skipped++; continue; }
      if (raw.trim() === '') continue;
      let ev; try { ev = JSON.parse(raw); } catch { out.skipped++; continue; }
      const type = own(ev, 'type');
      if (type === 'result') {
        out.results++;
        const cost = own(ev, 'total_cost_usd');
        if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) out.costUsd += cost;
        out.turns += count(own(ev, 'num_turns'), 1e6);
        const usage = own(ev, 'modelUsage');
        if (plain(usage) && Object.keys(usage).length > MAX_MODELS) out.modelsTruncated = true;
        if (plain(usage)) for (const m of Object.keys(usage).slice(0, MAX_MODELS)) {
          if (m.length > 120) { out.modelsTruncated = true; continue; }
          seen.add(m);
          const t = tokens.get(m) ?? Object.fromEntries(TOKEN_CLASSES.map((c) => [c, 0]));
          for (const c of TOKEN_CLASSES) t[c] = Math.min(1e12, t[c] + count(own(own(usage, m), CLASS_KEYS[c])));
          tokens.set(m, t);
        }
      } else if (type === 'assistant') {
        const msg = own(ev, 'message');
        const model = own(msg, 'model');
        if (typeof model === 'string' && model !== '<synthetic>') { if (model.length <= 120 && seen.size < MAX_MODELS) seen.add(model); else out.modelsTruncated = true; }
        const content = own(msg, 'content');
        if (!Array.isArray(content)) continue;
        for (const b of content.slice(0, MAX_BLOCKS)) {
          const name = own(b, 'name');
          if (own(b, 'type') !== 'tool_use' || typeof name !== 'string') continue;
          const id = own(b, 'id');
          if (typeof id === 'string' && id !== '') { if (ids.has(id) || ids.size >= MAX_IDS) continue; ids.add(id); }
          out.toolCalls++;
          if (name === 'Agent' || name === 'Task') out.subagents++;
        }
      }
    }
    if (out.results === 0) return null;
    const valid = [...tokens].filter(([m]) => ID.test(m)); const keep = valid.slice(0, 16);
    if (valid.length > 16) out.modelsTruncated = true;
    return { ...out, tokens: Object.fromEntries(keep), modelsSeen: [...seen].sort() };
  } catch { return null; } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* read-only handle */ } }
}

export function isPinned(id, alias, extra = []) {
  if (typeof id !== 'string' || typeof alias !== 'string' || alias === '') return false;
  if (id === alias || extra.includes(id)) return true;
  const at = id.indexOf(alias);
  for (let i = at; i >= 0; i = id.indexOf(alias, i + 1)) {
    const before = i === 0 || !/[A-Za-z0-9]/.test(id[i - 1]); const after = !/[A-Za-z0-9]/.test(id[i + alias.length] ?? '-');
    if (before && after) return true;
  }
  return false;
}

const zeroRow = (draw, reason) => ({
  row: { scenario: draw.scenario, arm: draw.arm, phase: draw.phase, tier: null, tierSource: 'none', outcome: 'invalid', costUsd: 0, durationMs: 0, turns: 0,
    tokens: {}, toolCalls: 0, subagents: 0, green: 0, total: 0, paused: false, models: [] }, reason });

export function toRow(draw, parsed, score, tierInfo) {
  let outcome = draw.outcome; let reason = String(draw.reason ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, 80);
  // An invalid draw keeps its first cause; a sizing probe (invalid by design) is still checked.
  const live = () => outcome !== 'invalid' || reason === 'probe';
  const fail = (why) => { if (live()) { outcome = 'invalid'; reason = why; } };
  const seen = parsed?.modelsSeen ?? [];
  if (live()) {
    if (parsed === null || parsed === undefined) fail('unusable-stream');
    else if (parsed.modelsTruncated) fail('models-truncated');
    else if (seen.length === 0) fail('models-unknown');
    else if (!seen.every((m) => isPinned(m, draw.model, draw.pinnedExtra))) fail('unpinned-model');
  }
  const hasScore = plain(score) && Number.isInteger(score.green) && Number.isInteger(score.total) && score.total >= 1;
  if (outcome === 'scored' && !hasScore) fail('unscored');
  const int = (x, max = 1e6) => (Number.isFinite(x) && x >= 0 ? Math.min(Math.round(x), max) : 0);
  const row = {
    scenario: draw.scenario, arm: draw.arm, phase: draw.phase,
    tier: typeof tierInfo?.tier === 'string' ? tierInfo.tier : null, tierSource: typeof tierInfo?.tierSource === 'string' ? tierInfo.tierSource : 'none',
    outcome, costUsd: Number.isFinite(draw.costUsd) && draw.costUsd >= 0 ? draw.costUsd : 0, durationMs: int(draw.durationMs, 1e9),
    turns: int(draw.turns ?? parsed?.turns), tokens: parsed?.tokens ?? {}, toolCalls: int(parsed?.toolCalls), subagents: int(parsed?.subagents),
    green: hasScore ? score.green : 0, total: hasScore ? score.total : 0, paused: outcome === 'paused', models: seen.filter((m) => ID.test(m)).slice(0, 16),
  };
  return rowProblems(row).length === 0 ? { row, reason } : zeroRow(draw, 'row-invalid');
}

// ---- plan and results ------------------------------------------------------------------------------------------

/** params: {phase, seed, model, pinnedExtra, ceilingSomi, pinAll, probe, repeats, scenarios: [{id, arms}], caps, limits, material, ruleHash, gitSha, pluginHash}. */
export function buildPlan(p) {
  const draws = [];
  for (let repeat = 1; repeat <= p.repeats; repeat++) {
    // A round holds every scenario once, in a seeded order; the arms of a scenario run back to back in a seeded order, so
    // a prefix of the run is balanced and the two arms of a pair meet nearly the same provider load.
    seededShuffle(p.scenarios, (p.seed + repeat) >>> 0).forEach((s, i) => {
      for (const arm of seededShuffle(s.arms, (p.seed * 31 + repeat * 7 + i) >>> 0)) draws.push({ id: `${s.id}-${arm}-${repeat}`, scenario: s.id, arm, repeat, order: draws.length });
    });
  }
  return { schema: 1, phase: p.phase, seed: p.seed, model: p.model, pinnedExtra: p.pinnedExtra, ceilingSomi: p.ceilingSomi, pinAll: p.pinAll, probe: p.probe, repeats: p.repeats,
    scenarios: p.scenarios.map((s) => s.id), caps: p.caps, limits: p.limits, material: p.material, ruleHash: p.ruleHash, gitSha: p.gitSha, pluginHash: p.pluginHash, draws };
}

const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : plain(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null');
/** Names of the fields in which `stored` differs from `fresh` (empty: same plan). gitSha never counts; `ignore` adds more. */
export function planMismatch(stored, fresh, ignore = []) {
  if (!plain(stored)) return ['plan'];
  const skip = new Set(['gitSha', ...ignore]);
  const keys = new Set([...Object.keys(fresh), ...Object.keys(stored)]);
  return [...keys].filter((k) => !skip.has(k) && canon(stored[k]) !== canon(fresh[k])).map((k) => (Object.hasOwn(fresh, k) ? k : 'unknown-field'));
}

const ENTRY_KEYS = ['schema', 'draw', 'status', 'reason', 'costUsd', 'resumes', 'computedTier', 'resetText', 'row'];
const PRINTABLE = /^[\x20-\x7e]*$/;
/** results.jsonl text -> {ok: true, entries} or {ok: false, reason}. Nothing is skipped: any doubt refuses the whole file. */
export function parseResults(text, plan) {
  if (text === '') return { ok: true, entries: [] };
  if (!text.endsWith('\n')) return { ok: false, reason: 'the last results line is torn (no line end)' };
  const byId = new Map(plan.draws.map((d) => [d.id, d])); const entries = []; const done = new Set();
  const rows = text.slice(0, -1).split('\n');
  for (let i = 0; i < rows.length; i++) {
    const at = `results line ${i + 1}`;
    let e; try { e = JSON.parse(rows[i]); } catch { return { ok: false, reason: `${at} is not JSON` }; }
    if (!plain(e) || Object.keys(e).length !== ENTRY_KEYS.length || !ENTRY_KEYS.every((k) => Object.hasOwn(e, k))) return { ok: false, reason: `${at} has the wrong keys` };
    const d = byId.get(e.draw);
    if (e.schema !== 1 || typeof e.draw !== 'string' || !d) return { ok: false, reason: `${at} names a draw that is not in the plan` };
    if (!['done', 'halted'].includes(e.status) || typeof e.reason !== 'string' || e.reason.length > 80 || !PRINTABLE.test(e.reason)) return { ok: false, reason: `${at}: status or reason invalid` };
    if (!Number.isFinite(e.costUsd) || e.costUsd < 0 || e.costUsd > 1e4 || !Number.isInteger(e.resumes) || e.resumes < 0 || e.resumes > 100) return { ok: false, reason: `${at}: cost or resumes out of range` };
    if (e.computedTier !== null && !TIER_NAMES.includes(e.computedTier)) return { ok: false, reason: `${at}: computedTier invalid` };
    if (e.resetText !== null && !(typeof e.resetText === 'string' && e.resetText.length <= 60 && PRINTABLE.test(e.resetText))) return { ok: false, reason: `${at}: resetText invalid` };
    if (done.has(e.draw)) return { ok: false, reason: `${at}: draw ${e.draw} has an entry after its terminal one` };
    if (e.status === 'halted') { if (e.row !== null || !HALT_REASONS.includes(e.reason)) return { ok: false, reason: `${at}: a halted entry needs a halt reason and no row` }; }
    else {
      const bad = rowProblems(e.row);
      if (bad.length > 0 || e.row.scenario !== d.scenario || e.row.arm !== d.arm || e.row.phase !== plan.phase) return { ok: false, reason: `${at}: the row does not validate for this plan` };
      done.add(e.draw);
    }
    entries.push(e);
  }
  return { ok: true, entries };
}

export const pendingDraws = (plan, entries) => { const done = new Set(entries.filter((e) => e.status === 'done').map((e) => e.draw)); return plan.draws.filter((d) => !done.has(d.id)); };
export const spentUsd = (entries) => entries.reduce((s, e) => s + e.costUsd, 0);

const median = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length === 0 ? null : (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
/** The run's text report: counts, medians and spend per scenario and arm. It reads no verdict into the data. */
export function buildBenchReport(plan, entries, halt) {
  const done = entries.filter((e) => e.status === 'done');
  const out = [`phase ${plan.phase}, model ${plan.model}, ceiling ${plan.ceilingSomi}, seed ${plan.seed}: ${done.length} of ${plan.draws.length} draw(s) have a terminal row`,
    `spend $${spentUsd(entries).toFixed(2)} over ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}; halt: ${halt ?? 'none'}`];
  for (const s of plan.scenarios) for (const arm of ARMS) {
    const es = done.filter((e) => e.row.scenario === s && e.row.arm === arm);
    if (es.length === 0) continue;
    const rs = es.map((e) => e.row); const tally = (f) => { const o = {}; for (const r of rs) o[f(r)] = (o[f(r)] ?? 0) + 1; return Object.entries(o).sort().map(([k, n]) => `${n} ${k}`).join(', '); };
    const fmt = (x, d = 2) => (x === null ? '-' : x.toFixed(d));
    out.push(`${s} ${arm}: ${tally((r) => r.outcome)}${arm === 'somi' ? `; tier ${tally((r) => r.tier ?? 'none')}` : ''}`,
      `  median cost $${fmt(median(rs.map((r) => r.costUsd)))}, time ${fmt(median(rs.map((r) => r.durationMs / 1000)), 0)} s, turns ${fmt(median(rs.map((r) => r.turns)), 1)}, tool calls ${fmt(median(rs.map((r) => r.toolCalls)), 1)}, subagents ${fmt(median(rs.map((r) => r.subagents)), 1)}, green ${fmt(median(rs.map((r) => (r.total > 0 ? r.green / r.total : NaN))))}`);
  }
  out.push('(no verdict is computed here; usage-compare.mjs computes verdicts from two baselines)');
  return out.join('\n');
}
