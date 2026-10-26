#!/usr/bin/env bash
# Pins the benchmark baseline schema (bench-schema.mjs), the verdict function (bench-verdict.mjs) and the compare
# CLI (tests/scripts/manual/usage-compare.mjs): known-answer verdicts against a test-local reference bootstrap,
# the guard, drift and stratum rules, every refusal, the secret and path scan, and the CLI exit codes. Each rule is
# then mutated on a scratch copy and the suite must fail. Hermetic: pure computation on generated fixtures; no
# model, network, git, wall clock or credential. Skipped in a tarball, where tests/evals is absent.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: benchmark schema, verdict and compare tool =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t bcm.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

CODE=$(cat <<'EOS'
const V = await import(`${process.env.LIB}/bench-verdict.mjs`);
const Sc = await import(`${process.env.LIB}/bench-schema.mjs`);
const R = await import(`${process.env.LIB}/bench-rule.mjs`);
const St = await import(`${process.env.LIB}/bench-stats.mjs`);
const fs = await import('node:fs');
const ROOT = process.env.ROOT;
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const draft = R.loadRule(`${ROOT}/benchmarks/usage-speed/rule.json`);
const RES = 1000;
const mkRule = (sealed, only = []) => R.parseRule({ ...draft.rule, sealed, scope: { distributionOnly: only }, bootstrap: { ...draft.rule.bootstrap, resamples: RES } });
const RS = mkRule(true); const RD = mkRule(false);
const SEED = draft.rule.bootstrap.seed;

// ---- fixtures ----
const SC = [{ id: 's1', repeats: 8, requiredTier: null }, { id: 's2', repeats: 8, requiredTier: 'small' }, { id: 's3', repeats: 8, requiredTier: null }];
const J = [0.95, 1, 1.05, 0.98, 1.02, 0.97, 1.03, 1];
const B = { somi: { time: 100000, cost: 1, turns: 20, tok: 10000 }, bare: { time: 40000, cost: 0.3, turns: 8, tok: 4000 } };
const ONE = { time: 1, cost: 1, turns: 1, tok: 1 };
function mk(o = {}) {
  const sc = o.scale ?? {};
  const rows = [];
  SC.forEach((s, si) => { for (const arm of ['somi', 'bare']) for (let i = 0; i < 8; i++) {
    const k = { ...ONE, ...(sc[arm] ?? {}) }; const f = [1, 1.5, 2][si] * J[i];
    const tok = Math.round(B[arm].tok * k.tok * f);
    let row = { scenario: s.id, arm, phase: 'experiment', tier: s.requiredTier, tierSource: 'recorded', outcome: 'scored', costUsd: +(B[arm].cost * k.cost * f).toFixed(6), durationMs: Math.round(B[arm].time * k.time * f), turns: Math.round(B[arm].turns * k.turns * f * 10), tokens: { m1: { input: Math.round(tok * 0.1), output: Math.round(tok * 0.05), cacheRead: Math.round(tok * 0.8), cacheCreation: tok - Math.round(tok * 0.1) - Math.round(tok * 0.05) - Math.round(tok * 0.8) } }, toolCalls: 5, subagents: 1, green: 4, total: 4, paused: false, models: ['m1'] };
    if (o.patch) row = o.patch(row, arm, si, i) ?? row;
    rows.push(row);
  } });
  const ev = (name, mult) => [name, Array.from({ length: o.l1n ?? 30 }, (_, i) => +((5 + (i % 7) * 0.2) * mult * (name === 'e2' ? 2 : 1)).toFixed(6))];
  return { schema: 1, sha: (o.sha ?? 'a').repeat(40), pluginVersion: '4.0.0', date: '2026-10-20', rule: { version: 1, hash: o.hash ?? RS.hash }, model: { alias: o.alias ?? 'alias-a', tier: o.tier ?? 'low' }, pinAll: o.pinAll ?? true,
    host: { cpuModel: 'cpu-x', cores: 8, memGb: 16, osRelease: o.os ?? 'os-1', nodeVersion: 'v22', pluginVersion: o.plugin ?? '4.0.0' }, scenarios: o.scenarios ?? SC,
    L0: { bytes: Object.fromEntries(Object.entries({ session: 1000, plan: 5000, ...(o.extraL0 ?? {}) }).map(([k, v]) => [k, Math.round(v * (o.l0 ?? 1))])) }, L1: { events: Object.fromEntries([ev('e1', o.l1 ?? 1), ev('e2', o.l1 ?? 1)]) }, L2: { rows } };
}
const base = mk({ sha: 'b' });
const V_ = (cand, o = {}, b = base, r = RS) => V.verdict(cand, b, r, { repoRoot: ROOT, ...o });
const head = (cand, metric, o) => V_(cand, { primaryMetric: metric, ...o });
const hv = (cand, metric, o) => { const r = head(cand, metric, o); return r.refused ? `REFUSED ${r.refused}` : r.verdict; };

// ---- schema ----
check('a generated baseline is valid', Sc.baselineProblems(base, { repoRoot: ROOT }), []);
const bad = (name, patch) => { const c = JSON.parse(JSON.stringify(base)); patch(c); check(`schema rejects ${name}`, Sc.baselineProblems(c).length > 0, true); };
bad('an unknown top-level key', (c) => { c.extra = 1; }); bad('a missing key', (c) => { delete c.host; }); bad('schema 2', (c) => { c.schema = 2; });
bad('a short sha', (c) => { c.sha = 'abc'; }); bad('a bad date', (c) => { c.date = '20 Oct'; }); bad('a non-boolean pinAll', (c) => { c.pinAll = 'yes'; });
bad('an unknown host key (hostname)', (c) => { c.host.hostname = 'box'; }); bad('a duplicate scenario id', (c) => { c.scenarios[1].id = 's1'; });
bad('a row with an unknown scenario', (c) => { c.L2.rows[0].scenario = 'zz'; }); bad('a bad arm', (c) => { c.L2.rows[0].arm = 'third'; });
bad('paused not matching outcome', (c) => { c.L2.rows[0].paused = true; }); bad('green above total', (c) => { c.L2.rows[0].green = 9; });
bad('a scored row with total 0', (c) => { c.L2.rows[0].green = 0; c.L2.rows[0].total = 0; }); bad('a negative cost', (c) => { c.L2.rows[0].costUsd = -1; });
bad('a fractional token count', (c) => { c.L2.rows[0].tokens.m1.input = 1.5; }); bad('an unknown token class', (c) => { c.L2.rows[0].tokens.m1.extra = 1; });
bad('a __proto__ model id', (c) => { c.L2.rows[0].tokens = JSON.parse('{"__proto__":{"input":1,"output":1,"cacheRead":1,"cacheCreation":1}}'); });
bad('zero L0 bytes', (c) => { c.L0.bytes.plan = 0; }); bad('an empty L1 sample list', (c) => { c.L1.events.e1 = []; }); bad('a non-array baseline', (c) => { c.L2.rows = {}; });
check('non-objects are invalid', [null, [], 'x', 5].map((v) => Sc.baselineProblems(v).length > 0), [true, true, true, true]);
const leak = (name, patch, opts) => { const c = JSON.parse(JSON.stringify(base)); patch(c); const p = Sc.baselineProblems(c, opts); check(`leak scan rejects ${name} and does not echo it`, [p.some((x) => x.includes('secret or path')), p.join(' ').includes('SECRETVALUE')], [true, false]); };
leak('an sk-ant token', (c) => { c.pluginVersion = 'sk-ant-SECRETVALUE1234'; });
leak('a long base64 run', (c) => { c.host.cpuModel = 'SECRETVALUE' + 'Zq9_'.repeat(12); });
leak('a long hex run in a key', (c) => { c.L1.events['SECRETVALUE' + 'ab'.repeat(20)] = [1]; });
leak('a home path', (c) => { c.host.osRelease = '/home/SECRETVALUE/x'; }); leak('a macOS home path', (c) => { c.host.osRelease = '/Users/SECRETVALUE/x'; });
leak('the repository path', (c) => { c.host.osRelease = 'at /srv/ci/work/repo'; }, { repoRoot: '/srv/ci/work/repo' });
leak('a bearer token', (c) => { c.host.osRelease = 'Bearer SECRETVALUE1234567'; });
check('the sha and rule hash fields are exempt from the long-run scan, ordinary strings pass', [Sc.findLeaks({ sha: 'a'.repeat(40), x: 'Intel(R) Core(TM) i7 @ 3.00GHz', y: '6.8.0-146-generic' }, { skip: ['$.sha'] }).length, Sc.findLeaks({ sha: 'a'.repeat(40) }).length], [0, 1]);

// ---- reference bootstrap (own PRNG, own loops) ----
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const med = (xs) => { const s = [...xs].sort((p, q) => p - q); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const gm = (xs) => Math.exp(xs.reduce((t, x) => t + Math.log(x), 0) / xs.length);
function ref(strata, ratioOf) {
  const rnd = prng(SEED); const out = [];
  for (let r = 0; r < RES; r++) out.push(gm(strata.map((arms) => ratioOf(arms.map((xs) => med(xs.map(() => xs[Math.floor(rnd() * xs.length)])))))));
  out.sort((p, q) => p - q);
  return { estimate: gm(strata.map((arms) => ratioOf(arms.map(med)))), lower: out[50], upper: out[RES - 1 - 50] };
}
const col = (b, s, arm, f) => b.L2.rows.filter((r) => r.scenario === s && r.arm === arm).map(f);
const costOf = (r) => r.costUsd;
const absR = (x) => x[0] / x[1]; const ovR = (x) => (x[0] / x[1]) / (x[2] / x[3]);
const pick = (r, m, role = 'primary') => (m === 'secondary' ? r.secondary : r.metrics.find((q) => q.metric === m && q.role === role));
const est = (q) => q && { estimate: q.estimate, lower: q.lower, upper: q.upper };

// ---- known answers ----
const better = mk({ scale: { somi: { cost: 0.5, time: 0.5, tok: 0.5, turns: 0.5 } } });
const worse = mk({ scale: { somi: { cost: 1.6, time: 1.6, tok: 1.6, turns: 1.6 } } });
const same = mk({});
check('clear better: every L2 metric reads better', ['cost', 'time', 'tokens', 'turns'].map((m) => hv(better, m)), Array(4).fill('better'));
check('clear worse: every L2 metric reads worse', ['cost', 'time', 'tokens', 'turns'].map((m) => hv(worse, m)), Array(4).fill('worse'));
check('null effect: every L2 metric is inconclusive', ['cost', 'time', 'tokens', 'turns'].map((m) => hv(same, m)), Array(4).fill('inconclusive'));
const rb = head(better, 'cost');
check('cost primary is the overhead ratio and equals the reference bootstrap exactly', est(pick(rb, 'cost')), ref(SC.map((s) => [col(better, s.id, 'somi', costOf), col(better, s.id, 'bare', costOf), col(base, s.id, 'somi', costOf), col(base, s.id, 'bare', costOf)]), ovR));
check('the cost secondary is the absolute SoMi ratio and equals the reference exactly', est(rb.secondary), ref(SC.map((s) => [col(better, s.id, 'somi', costOf), col(base, s.id, 'somi', costOf)]), absR));
const rt = head(better, 'tokens');
const tokOf = (r) => Object.values(r.tokens).reduce((t, m) => t + m.input + m.output + m.cacheRead + m.cacheCreation, 0);
check('tokens primary is the absolute ratio (sum of the four classes) and equals the reference exactly', est(pick(rt, 'tokens')), ref(SC.map((s) => [col(better, s.id, 'somi', tokOf), col(base, s.id, 'somi', tokOf)]), absR));
check('the tokens secondary is the overhead ratio', rt.secondary.basis, 'overhead');
check('worse: the interval lies above 1.2 and the estimate is near 1.6', [pick(head(worse, 'cost'), 'cost').lower > 1.2, Math.abs(pick(head(worse, 'cost'), 'cost').estimate - 1.6) < 0.01], [true, true]);
const two = St.scenarioStratified(SC.map((s) => ({ a: col(better, s.id, 'somi', costOf), b: col(base, s.id, 'somi', costOf) })), { seed: SEED, resamples: RES });
check('two-arm resampling is bench-stats scenarioStratified exactly (absolute cost)', [pick(rb, 'cost', 'reported')?.estimate, rb.secondary.estimate, rb.secondary.lower, rb.secondary.upper], [undefined, two.estimate, two.lower, two.upper]);
check('only the named metric has role primary; the others are reported with a status', [rb.metrics.filter((q) => q.role === 'primary').length, rb.metrics.filter((q) => q.role === 'reported').length, rb.metrics.map((q) => q.metric)], [1, 5, ['bytes', 'ms', 'time', 'cost', 'tokens', 'turns']]);
check('a better non-primary metric cannot headline: turns primary on a cost-only win is inconclusive', hv(mk({ scale: { somi: { cost: 0.5 } } }), 'turns'), 'inconclusive');
const NZ = [0.4, 1.6, 0.5, 1.5, 0.45, 1.55, 0.6, 1.4];
const noisyCost = (k) => mk({ scale: { somi: { cost: k } }, patch: (r, a, si, i) => (a === 'somi' ? { ...r, costUsd: +(r.costUsd * NZ[i]).toFixed(6) } : r) });
check('a point estimate beyond the minimum is not enough: a noisy 0.7x and 1.4x stay inconclusive', [noisyCost(0.7), noisyCost(1.4)].map((c) => [pick(head(c, 'cost'), 'cost').estimate < 0.8 || pick(head(c, 'cost'), 'cost').estimate > 1.2, hv(c, 'cost')]), [[true, 'inconclusive'], [true, 'inconclusive']]);
check('same input twice: byte-identical JSON', JSON.stringify(head(better, 'cost')) === JSON.stringify(head(better, 'cost')), true);
check('ratio direction is candidate over baseline (swapping the two flips better to worse)', hv(base, 'cost', {}) , 'inconclusive');
check('swapped roles: a worse candidate against a better baseline is worse', V.verdict(base, better, RS, { primaryMetric: 'cost', repoRoot: ROOT }).verdict, 'worse');
check('the result names the rule hash, tier, alias and shas', [rb.ruleHash === RS.hash, rb.tier, rb.alias, rb.candidateSha[0], rb.baselineSha[0], rb.draft], [true, 'low', 'alias-a', 'a', 'b', false]);

// L0 and L1
check('L0: 0.9x bytes better, 1.02x worse, 0.995x inside the 1% minimum inconclusive, exactly 0.99 not beyond', ['0.9', '1.02', '0.995', '0.99'].map((x) => hv(mk({ l0: +x }), 'bytes')), ['better', 'worse', 'inconclusive', 'inconclusive']);
check('L0 is exact: the interval is the point and the estimate is the geometric mean of the per-scenario ratios', (() => { const q = pick(head(mk({ l0: 0.9 }), 'bytes'), 'bytes'); return [q.lower === q.estimate && q.upper === q.estimate, Math.abs(q.estimate - 0.9) < 1e-3]; })(), [true, true]);
const l1b = mk({ l1: 0.8 });
check('L1: 0.8x better, 1.3x worse, 1.0x inconclusive, 0.95x inside the 10% minimum', [0.8, 1.3, 1, 0.95].map((x) => hv(mk({ l1: x }), 'ms')), ['better', 'worse', 'inconclusive', 'inconclusive']);
check('L1 equals the two-arm stratified reference over events', est(pick(head(l1b, 'ms'), 'ms')), (() => { const s = St.scenarioStratified(['e1', 'e2'].map((e) => ({ a: l1b.L1.events[e], b: base.L1.events[e] })), { seed: SEED, resamples: RES }); return { estimate: s.estimate, lower: s.lower, upper: s.upper }; })());

// guard
const lowGreen = (n) => (row, arm, si, i) => (arm === 'somi' && i < n ? { ...row, green: 0 } : arm === 'somi' && n === 99 ? { ...row, green: 1 } : row);
const sc50 = { somi: { cost: 0.5 } };
check('guard: better with a candidate median fraction 0.75 below turns inconclusive-guarded', hv(mk({ scale: sc50, patch: (r, a) => (a === 'somi' ? { ...r, green: 1 } : r) }), 'cost'), 'inconclusive-guarded');
check('guard: median drop exactly 0.20 does not trip (fraction 0.8 against 1.0)', hv(mk({ scale: sc50, patch: (r, a) => (a === 'somi' ? { ...r, green: 4, total: 5 } : r) }), 'cost'), 'better');
check('guard: 3 zero draws of 8 (share +0.375, median unchanged) trips; 2 of 8 (exactly +0.25) does not', [hv(mk({ scale: sc50, patch: lowGreen(3) }), 'cost'), hv(mk({ scale: sc50, patch: lowGreen(2) }), 'cost')], ['inconclusive-guarded', 'better']);
check('guard never creates better: null effect with a quality drop stays inconclusive', hv(mk({ patch: (r, a) => (a === 'somi' ? { ...r, green: 0 } : r) }), 'cost'), 'inconclusive');
check('guard never changes worse', hv(mk({ scale: { somi: { cost: 1.6 } }, patch: (r, a) => (a === 'somi' ? { ...r, green: 0 } : r) }), 'cost'), 'worse');
check('guard does not apply to the bare arm', hv(mk({ scale: sc50, patch: (r, a) => (a === 'bare' ? { ...r, green: 0 } : r) }), 'cost'), 'better');
check('guard is reported with per-scenario figures and not evaluated for L0', [head(mk({ scale: sc50, patch: lowGreen(3) }), 'cost').guard.tripped, head(better, 'bytes').guard], [true, null]);
check('an over-budget candidate draw counts as a zero draw (3 of 8 trips the guard)', hv(mk({ scale: sc50, patch: (r, a, si, i) => (a === 'somi' && i < 3 ? { ...r, outcome: 'over-budget', green: 0 } : r) }), 'cost'), 'inconclusive-guarded');
const ob = (n) => (r, a, si, i) => (a === 'somi' && i < n ? { ...r, outcome: 'over-budget' } : r);
check('over-budget draws have quality fraction 0 even if they carry green: 5 of 8 against 4 of 8 drops the median to 0 (share rise only 0.125)', V_(mk({ scale: sc50, patch: ob(5) }), { primaryMetric: 'cost' }, mk({ sha: 'b', patch: ob(4) })).verdict, 'inconclusive-guarded');
// drift
check('drift: overhead says better while the absolute SoMi ratio is clearly worse (bare got dearer)', hv(mk({ scale: { somi: { cost: 1.2 }, bare: { cost: 2.5 } } }), 'cost'), 'inconclusive-drift');
check('drift: tokens absolute better while the overhead ratio is clearly worse', hv(mk({ scale: { somi: { tok: 0.5 }, bare: { tok: 0.2 } } }), 'tokens'), 'inconclusive-drift');
check('drift: worse primary with a clearly better secondary', hv(mk({ scale: { somi: { cost: 1.6 }, bare: { cost: 3.5 } } }), 'cost'), 'inconclusive-drift');
check('no drift when the secondary agrees (both better) or is merely inconclusive (absolute ratio 1.0)', [hv(better, 'cost'), hv(mk({ scale: { bare: { cost: 1.5 } } }), 'cost')], ['better', 'better']);
check('drift outranks the guard', hv(mk({ scale: { somi: { cost: 1.2 }, bare: { cost: 2.5 } }, patch: (r, a) => (a === 'somi' ? { ...r, green: 0 } : r) }), 'cost'), 'inconclusive-drift');

// draws: paused, off-tier, invalid
const hugeOn = (n, f) => (row, arm, si, i) => (arm === 'somi' && si === 1 && i < n ? f(row) : row);
const offTier = head(mk({ scale: sc50, patch: hugeOn(2, (r) => ({ ...r, tier: 'full', costUsd: 500 })) }), 'cost');
check('off-tier draws are counted in their own stratum and do not enter the ratio', [offTier.draws.candidate.somi.offStratum, offTier.verdict, pick(offTier, 'cost').estimate < 0.7], [2, 'better', true]);
const paused = head(mk({ scale: sc50, patch: hugeOn(2, (r) => ({ ...r, outcome: 'paused', paused: true, costUsd: 500, green: 0 })) }), 'cost');
check('paused draws are counted separately, not zeroed into the quality fraction and not in the samples', [paused.draws.candidate.somi.paused, paused.verdict, paused.guard.tripped], [2, 'better', false]);
check('invalid draws are counted and excluded from the samples', head(mk({ scale: sc50, patch: hugeOn(1, (r) => ({ ...r, outcome: 'invalid', green: 0, total: 0, costUsd: 500 })) }), 'cost').draws.candidate.somi.invalid, 1);
check('a scenario with no usable draws in an arm is a refusal for L2', hv(mk({ patch: (r, a, si) => (a === 'bare' && si === 0 ? { ...r, outcome: 'invalid', green: 0, total: 0 } : r) }), 'cost').startsWith('REFUSED'), true);

// ---- refusals ----
const refused = (name, c, o, b, r, why = '') => { const x = V_(c, { primaryMetric: 'cost', ...o }, b ?? base, r ?? RS); check(`refusal: ${name}`, [typeof x.refused, x.code, String(x.refused).includes(why)], ['string', 'refusal', true]); return x; };
refused('different rule hashes', mk({ hash: 'c'.repeat(64) }), {}, undefined, undefined, 'hash differs between');
refused('both baselines recorded under a rule other than the loaded one', mk({ hash: 'c'.repeat(64) }), {}, mk({ sha: 'b', hash: 'c'.repeat(64) }), undefined, 'different rule than');
refused('an unsealed rule without the draft flag', better, {}, base, RD, 'not sealed');
check('the draft flag labels the result DRAFT', [V_(better, { primaryMetric: 'cost', draft: true }, base, RD).draft, V_(better, { primaryMetric: 'cost', draft: true }, base, RD).verdict], [true, 'better']);
check('hash is the same for sealed and draft (a baseline recorded in the draft state compares under the sealed rule)', RS.hash === RD.hash, true);
refused('a different model alias', mk({ alias: 'alias-b' }), {}, undefined, undefined, 'alias'); refused('a different model tier', mk({ tier: 'high' }), {}, undefined, undefined, 'tier'); refused('a different pin-all flag', mk({ pinAll: false }), {}, undefined, undefined, 'pin-all');
refused('a different scenario list (repeats)', mk({ scenarios: SC.map((s) => ({ ...s, repeats: 9 })) }), {}, undefined, undefined, 'scenario lists'); refused('a different scenario list (required tier)', mk({ scenarios: SC.map((s) => ({ ...s, requiredTier: null })) }));
refused('a different L0 entry set', mk({ extraL0: { review: 100 } }));
refused('a row from the calibration phase', mk({ patch: (r, a, si, i) => (i === 0 && si === 0 ? { ...r, phase: 'calibration' } : r) }), {}, undefined, undefined, 'phase');
check('host fingerprint: ms and time are refused across hosts, bytes, tokens, turns and cost still compare', ['ms', 'time', 'bytes', 'tokens', 'turns', 'cost'].map((m) => hv(mk({ os: 'os-2', scale: sc50 }), m).startsWith('REFUSED')), [true, true, false, false, false, false]);
check('host fingerprint ignores the plugin version', hv(mk({ plugin: '4.1.0' }), 'ms'), 'inconclusive');
check('the non-comparable time row is reported, not dropped, when another metric is primary', pick(head(mk({ os: 'os-2' }), 'cost'), 'time', 'reported').status, 'not-comparable');
check('L1 with fewer than 30 repeats is refused for ms, and the other metrics still compare', [hv(mk({ l1n: 29 }), 'ms').startsWith('REFUSED'), hv(mk({ l1n: 30 }), 'ms'), hv(mk({ l1n: 29 }), 'bytes')], [true, 'inconclusive', 'inconclusive']);
check('the primary metric is required, single and known', [undefined, null, 'latency', ['cost', 'time'], 5].map((m) => typeof V_(better, { primaryMetric: m }).refused), Array(5).fill('string'));
check('no options at all is a refusal', typeof V.verdict(better, base, RS).refused, 'string');
const inv = (c) => { const x = V_(c, { primaryMetric: 'cost' }); return [typeof x.refused, x.code]; };
check('an invalid schema is invalid-input, on either side', [inv({ ...better, extra: 1 }), V.verdict(better, { ...base, schema: 3 }, RS, { primaryMetric: 'cost' }).code], [['string', 'invalid-input'], 'invalid-input']);
check('a secret in a baseline is refused as invalid input', inv({ ...better, pluginVersion: 'sk-ant-abcdefgh12345' }), ['string', 'invalid-input']);
check('a home path in a baseline is refused', inv({ ...better, host: { ...better.host, osRelease: '/home/someone/x' } }), ['string', 'invalid-input']);
check('a rule that is not parsed is invalid-input', [V.verdict(better, base, null, { primaryMetric: 'cost' }).code, V.verdict(better, base, { rule: {}, hash: 1 }, { primaryMetric: 'cost' }).code], ['invalid-input', 'invalid-input']);
check('no input throws', (() => { try { return [V.verdict(null, null, RS, { primaryMetric: 'cost' }).code, V.verdict(better, base, RS, null).code]; } catch { return 'THREW'; } })(), ['invalid-input', 'invalid-input']);

// ---- scope: distribution-only scenarios ----
const RO = mkRule(true, ['s2']); const ROD = mkRule(false, ['s2']);
const mo = (o = {}) => mk({ hash: RO.hash, ...o });
const baseO = mo({ sha: 'b' });
const hvo = (cand, metric, o = {}) => { const x = V.verdict(cand, o.b ?? baseO, o.r ?? RO, { repoRoot: ROOT, primaryMetric: metric }); return x.refused ? { refused: x.refused, code: x.code } : x; };
const s2Cost = (k) => ({ patch: (row, arm, si) => (si === 1 && arm === 'somi' ? { ...row, costUsd: row.costUsd * k } : row) });
const costEst = (r) => r.metrics.find((m) => m.metric === 'cost').estimate;
check('naming a distribution-only scenario changes the rule hash; sealed state still does not', [RS.hash !== RO.hash, RO.hash === ROD.hash], [true, true]);
check('a distribution-only scenario does not enter the ratio: a 5x cost change there moves the pooled estimate when it is a stratum, not when excluded', [costEst(head(mk({ sha: 'a', ...s2Cost(5) }), 'cost')) > 1.2, Math.abs(costEst(hvo(mo({ sha: 'a', ...s2Cost(5) }), 'cost')) - 1) < 0.05], [true, true]);
check('the excluded scenario is reported with both sides and arms: usable draws and green medians', hvo(mo({ sha: 'a' }), 'cost').scope.distributionOnly.map((d) => [d.scenario, d.candidate.somi.draws, d.baseline.bare.draws, d.candidate.somi.greenMedian, d.baseline.bare.greenMedian]), [['s2', 8, 8, 1, 1]]);
check('with no distribution-only scenario the scope list is empty', head(base, 'cost').scope.distributionOnly, []);
const s2Zero = (extra = {}) => mo({ sha: 'a', ...extra, patch: (row, arm, si) => (si === 1 && arm === 'somi' ? { ...row, green: 0 } : row) });
check('the quality guard still sees a distribution-only scenario: a green collapse there blocks a better', [hvo(s2Zero({ scale: { somi: { cost: 0.5 } } }), 'cost').verdict, hvo(mo({ sha: 'a', scale: { somi: { cost: 0.5 } } }), 'cost').verdict], ['inconclusive-guarded', 'better']);
check('the green median of the excluded scenario shows the collapse', hvo(s2Zero(), 'cost').scope.distributionOnly[0].candidate.somi.greenMedian, 0);
const RA = mkRule(true, ['s1', 's2', 's3']); const mA = (o = {}) => mk({ hash: RA.hash, ...o });
const allOut = hvo(mA({ sha: 'a' }), 'cost', { b: mA({ sha: 'b' }), r: RA });
check('every scenario distribution-only: an L2 primary is refused with the reason', [typeof allOut.refused, /every scenario is distribution-only/.test(allOut.refused ?? '')], ['string', true]);
const allOutL0 = hvo(mA({ sha: 'a' }), 'bytes', { b: mA({ sha: 'b' }), r: RA });
check('every scenario distribution-only: an L0 primary still gets a verdict and the L2 row reads not-comparable', [allOutL0.verdict, allOutL0.metrics.find((m) => m.metric === 'cost').status], ['inconclusive', 'not-comparable']);
const RZ = mkRule(true, ['zz']);
check('a rule scope naming a scenario the baselines lack is invalid input', hvo(mk({ sha: 'a', hash: RZ.hash }), 'cost', { b: mk({ sha: 'b', hash: RZ.hash }), r: RZ }).code, 'invalid-input');

// CLI fixtures (the shell runs the tool on these; the draft rule's hash is the shipped one)
if (process.env.FIXDIR) {
  // the shipped rule names scenarios by their registered ids, so the CLI fixtures use them too
  const w = (n, o) => fs.writeFileSync(`${process.env.FIXDIR}/${n}.json`, JSON.stringify(o).replace(/"s([123])"/g, '"S$1"'));
  w('cand', mk({ hash: draft.hash, scale: sc50 })); w('base', mk({ sha: 'b', hash: draft.hash })); w('invalid', { ...mk({ hash: draft.hash }), extra: 1 });
  w('leak', mk({ hash: draft.hash, plugin: 'sk-ant-abcdefgh12345' })); fs.writeFileSync(`${process.env.FIXDIR}/bad.json`, '{no');
}
for (const [ok, name, got, w] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(w) + ', got ' + JSON.stringify(got) + ')'));
EOS
)
suite() { LIB="$1" ROOT="$ROOT" FIXDIR="${2:-}" node --input-type=module -e "$CODE" 2>&1; }
mkdir "$TMP/fix"
out=$(suite "$ROOT/tests/evals/lib" "$TMP/fix") || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"

# CLI: exit codes and output.
CLI=tests/scripts/manual/usage-compare.mjs
cli() { node "$CLI" "$@" >"$TMP/o.txt" 2>"$TMP/e.txt"; echo $?; }
chk() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf '  ok   %s\n' "$1"; else fail=$((fail+1)); printf '  FAIL %s (want %s, got %s)\n' "$1" "$3" "$2"; fi; }
F="$TMP/fix"
chk "cli: a draft verdict exits 0" "$(cli "$F/cand.json" "$F/base.json" --primary cost --draft)" 0
grep -q '^VERDICT: better$' "$TMP/o.txt" && grep -q '^LIMITS' "$TMP/o.txt" && grep -q 'rule hash: [0-9a-f]\{64\}' "$TMP/o.txt" && grep -q 'tier (low)\|recorded model tier only (low)' "$TMP/o.txt"; chk "cli: prints the verdict, the rule hash and the limits block" "$?" 0
chk "cli: the sealed shipped rule gives a registered verdict without the draft flag" "$(cli "$F/cand.json" "$F/base.json" --primary cost)" 0
! grep -q 'DRAFT' "$TMP/o.txt"; chk "cli: a sealed rule output carries no DRAFT note" "$?" 0
chk "cli: a missing --primary is a usage error (64)" "$(cli "$F/cand.json" "$F/base.json")" 64
chk "cli: one file only is a usage error (64)" "$(cli "$F/cand.json" --primary cost)" 64
chk "cli: an unknown flag is a usage error (64)" "$(cli "$F/cand.json" "$F/base.json" --primary cost --force)" 64
chk "cli: an invalid baseline exits 65" "$(cli "$F/invalid.json" "$F/base.json" --primary cost --draft)" 65
chk "cli: a baseline with a secret exits 65" "$(cli "$F/leak.json" "$F/base.json" --primary cost --draft)" 65
chk "cli: unparseable JSON exits 65" "$(cli "$F/bad.json" "$F/base.json" --primary cost --draft)" 65
chk "cli: a missing file exits 65" "$(cli "$F/none.json" "$F/base.json" --primary cost --draft)" 65
chk "cli: a refusal still prints the limits block" "$(cli "$F/cand.json" "$F/base.json" --primary latency --draft)" 64
grep -q '^LIMITS' "$TMP/o.txt"; chk "cli: limits block present on a refusal" "$?" 0
chk "cli: a draft verdict under the shipped scope exits 0" "$(cli "$F/cand.json" "$F/base.json" --primary cost --draft)" 0
grep -q 'distribution-only (not in any ratio)' "$TMP/o.txt" && grep -q 'Distribution-only scenarios' "$TMP/o.txt" && grep -q 'only large changes' "$TMP/o.txt"; chk "cli: prints the excluded scenarios and the limits state the large-change resolution" "$?" 0
if grep -q 'sk-ant' "$TMP/o.txt" "$TMP/e.txt"; then chk "cli: output never echoes the secret" bad ok; else chk "cli: output never echoes the secret" ok ok; fi

# Mutation: each rule is broken on a scratch copy of the libraries; the suite must then fail.
nm=0
mutant() { # file, from, to, label
  local d="$TMP/m$((++nm))"; mkdir "$d"; cp tests/evals/lib/bench-*.mjs tests/evals/lib/mann-whitney.mjs "$d/"
  if ! M_FILE="$d/$1" M_FROM="$2" M_TO="$3" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))"; then fail=$((fail+1)); printf '  FAIL mutation did not apply: %s\n' "$4"; return; fi
  mo=$(suite "$d")
  if grep -qv $'^ok\t' <<< "$mo"; then pass=$((pass+1)); printf '  ok   mutation caught: %s\n' "$4"; else fail=$((fail+1)); printf '  FAIL mutation survived: %s\n' "$4"; fi
}
VB=bench-verdict.mjs; SB=bench-schema.mjs
mutant $VB "if (out === 'better' && q && q.tripped) out = 'inconclusive-guarded';" "if (out === 'inconclusive' && q && q.tripped) out = 'better';" "the guard creates a better"
mutant $VB "if (out === 'better' && q && q.tripped)" "if (out !== 'inconclusive' && q && q.tripped)" "the guard changes a worse"
mutant $VB "if (out === 'better' && q && q.tripped)" "if (out !== 'better' && q && q.tripped)" "the guard changes an inconclusive"
mutant $VB "hi < 1 - m ? 'better'" "lo < 1 - m ? 'better'" "better from the point side, not the whole interval"
mutant $VB "lo > 1 + m ? 'worse'" "hi > 1 + m ? 'worse'" "worse from the point side, not the whole interval"
mutant $VB "hi < 1 - m ?" "hi <= 1 - m ?" "strict beyond-the-minimum for better"
mutant $VB "if (secondary.status === opposite) out = 'inconclusive-drift';" "if (false) out = 'inconclusive-drift';" "the secondary is ignored"
mutant $VB "const opposite = out === 'better' ? 'worse' : 'better';" "const opposite = out === 'better' ? 'better' : 'worse';" "drift direction"
mutant $VB "status(secondary.lower, secondary.upper, 0)" "status(secondary.lower, secondary.upper, 0.2)" "secondary needs zero effect only"
mutant $VB "(x) => (x[0] / x[1]) / (x[2] / x[3])" "(x) => (x[0] / x[1]) * (x[2] / x[3])" "overhead ratio formula"
mutant $VB "basis === 'absolute' ? (x) => x[0] / x[1]" "basis === 'absolute' ? (x) => x[1] / x[0]" "absolute ratio direction"
mutant $VB "(x) => x[0] / x[1], o);" "(x) => x[1] / x[0], o);" "L1 ratio direction"
mutant $VB "const inStratum = (row, sc) => sc.requiredTier === null || row.tier === sc.requiredTier;" "const inStratum = () => true;" "off-tier draws leak into the samples"
mutant $VB "row.outcome === 'scored' && !row.paused && inStratum(row, sc)" "row.outcome !== 'invalid' && inStratum(row, sc)" "paused and over-budget draws enter the samples"
mutant $VB "r.outcome === 'over-budget' ? 0 : r.green / r.total" "r.green / r.total" "over-budget not counted as zero quality"
mutant $VB "exceeds(drop, q.medianDrop) || exceeds(rise, q.invalidShareIncrease)" "exceeds(drop, q.medianDrop)" "invalid share guard"
mutant $VB "exceeds(drop, q.medianDrop) ||" "false ||" "median drop guard"
mutant $VB "diff - margin > 1e-9" "diff - margin >= -1e-9" "guard margin is strict"
mutant $VB "if (c.rule.hash !== b.rule.hash) return refusal(" "if (false) return refusal(" "refusal removed: rule hash differs"
mutant $VB "if (c.rule.hash !== hash || c.rule.version !== rule.version) return refusal(" "if (false) return refusal(" "refusal removed: other than the loaded rule"
mutant $VB "if (!ruleInfo.sealed && opts.draft !== true) return refusal(" "if (false) return refusal(" "refusal removed: unsealed rule"
mutant $VB "if (c.model.alias !== b.model.alias) return refusal(" "if (false) return refusal(" "refusal removed: model alias"
mutant $VB "if (c.model.tier !== b.model.tier) return refusal(" "if (false) return refusal(" "refusal removed: model tier"
mutant $VB "if (c.pinAll !== b.pinAll) return refusal(" "if (false) return refusal(" "refusal removed: pin-all"
mutant $VB "if (list(c) !== list(b) ||" "if (false ||" "refusal removed: scenario lists"
mutant $VB "if (x.L2.rows.some((r) => r.phase !== 'experiment')) return refusal(" "if (false) return refusal(" "refusal removed: mixed phases"
mutant $VB "if (WALL.includes(t.metric) && !sameHost)" "if (false)" "refusal removed: host fingerprint"
mutant $VB "{ ...h, pluginVersion: 0 }" "h" "host comparison keeps the plugin version"
mutant $VB "c.L1.events[k].length < rule.minEffect.L1.minRepeats ||" "false ||" "refusal removed: L1 repeats"
mutant $VB "|| !table.some((t) => t.metric === pm)) return refusal" ") return refusal" "refusal removed: unknown primary metric"
mutant $VB "const ratioScenarios = c.scenarios.filter((s) => !only.includes(s.id));" "const ratioScenarios = c.scenarios;" "distribution-only scenarios enter the ratio"
mutant $VB "if (!ratioScenarios.length) return na(" "if (false) return na(" "no ratio stratum left is not flagged"
mutant $VB "if (absent.length) return refusal(" "if (false) return refusal(" "refusal removed: unknown scope scenario"
mutant $VB "const [c, b] = [pick(cand), pick(base)];" "const [c, b] = [pick(cand), pick(base)].map((x) => x.filter((r) => !rule.scope.distributionOnly.includes(r.scenario)));" "guard skips distribution-only scenarios"
mutant $VB "if (p.length) return refusal(" "if (false) return refusal(" "refusal removed: invalid schema"
mutant $SB "for (const l of findLeaks(b," "for (const l of [] || findLeaks(b," "the secret and path check removed"
mutant $SB "[/sk-[A-Za-z0-9_-]{8,}/, 'token-like string']," "" "token pattern removed"
mutant $SB "[/[A-Za-z0-9+/_=-]{40,}/, 'long encoded run']," "" "long-run pattern removed"
mutant $SB "[/\\/(?:home|Users|root)\\/[^\\s/]+|[A-Za-z]:\\\\+Users\\\\+/, 'home path']," "" "home-path pattern removed"
mutant $SB "v.includes(repoRoot)" "false" "repository-path check removed"
mutant $SB "r.paused !== (r.outcome === 'paused')" "false" "paused/outcome consistency"
mutant $SB "for (const k of own) if (!keys.includes(k))" "for (const k of []) if (!keys.includes(k))" "unknown keys refused"

ran=$((pass + fail))
[ "$ran" -ge 140 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 140 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
