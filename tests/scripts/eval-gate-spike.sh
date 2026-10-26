#!/usr/bin/env bash
# Pins the spike go/no-go (FR-2) and the cost probe decision (FR-1a, FR-36) in
# tests/evals/lib/spike.mjs. Hermetic: pure computation, no model, network or credential. Skipped in
# a published tarball, where tests/evals is absent by design.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: spike go/no-go & 1a probe =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

out=$(node --input-type=module -e "
import { spikeDecision, probeDecision, UNITS } from './tests/evals/lib/spike.mjs';
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const safe = (f) => { try { return f(); } catch { return 'THREW'; } };

const draws = (fails, filler = 'fail') => [...Array(fails).fill(filler), ...Array(15 - fails).fill('pass')];
const spike = (o = {}) => spikeDecision({ draws: draws(1), spendUsd: 100, stage0Seen: false, invalidSeen: 0, ...o });
const verdictOf = (o) => spike(o)?.verdict ?? null;

// FR-2: each threshold pinned by verdict on both sides of its boundary.
check('14/15 clean -> go', verdictOf({}), 'go');
check('15/15 clean -> go', verdictOf({ draws: draws(0) }), 'go');
check('13/15 -> no-go: p̂', verdictOf({ draws: draws(2) }), 'no-go: p̂');
check('14/15 + Stage 0 -> no-go: stage0', verdictOf({ stage0Seen: true }), 'no-go: stage0');
check('spend \$208 exactly -> go', verdictOf({ spendUsd: 208 }), 'go');
check('spend \$208.01 -> no-go: spend', verdictOf({ spendUsd: 208.01 }), 'no-go: spend');
check('over-budget draws count as fails (2 -> 13/15)', verdictOf({ draws: draws(2, 'over-budget') }), 'no-go: p̂');
check('unexpected-pause counts as a fail', verdictOf({ draws: draws(2, 'unexpected-pause') }), 'no-go: p̂');
check('1 over-budget is the one allowed fail -> go', verdictOf({ draws: draws(1, 'over-budget') }), 'go');
const all3 = spike({ draws: draws(5), stage0Seen: true, spendUsd: 300 });
check('all three failing: p̂ primary, all three listed in FR-2 order', [all3.verdict, all3.reasons.length, all3.reasons.map((r) => r.split(' ')[0]).join()], ['no-go: p̂', 3, '10/15,Stage,spend']);
check('stage0 + spend failing: stage0 primary, both listed', [spike({ stage0Seen: true, spendUsd: 300 }).verdict, spike({ stage0Seen: true, spendUsd: 300 }).reasons.length], ['no-go: stage0', 2]);
check('p̂ + spend failing: p̂ primary', spike({ draws: draws(2), spendUsd: 300 }).verdict, 'no-go: p̂');
check('go reason carries the numbers used', spike().reason, '14/15 passes >= 14, no Stage 0, spend \$100.00 <= \$208.00');
check('invalid replacements: 5 allowed, 6 -> inconclusive', [verdictOf({ invalidSeen: 5 }), verdictOf({ invalidSeen: 6 })], ['go', 'inconclusive']);
check('inconclusive with a complete clean set and 6 invalid seen', verdictOf({ invalidSeen: 6 }), 'inconclusive');
check('certain no-go beats inconclusive and is listed first', [verdictOf({ invalidSeen: 6, stage0Seen: true }), verdictOf({ invalidSeen: 6, draws: draws(2) }), verdictOf({ invalidSeen: 6, spendUsd: 999, draws: draws(0).slice(5) })], ['no-go: stage0', 'no-go: p̂', 'no-go: spend']);
check('certain no-go beats inconclusive: reasons list the certain failures only', spike({ invalidSeen: 6, stage0Seen: true }).reasons, ['Stage 0 seen']);

// Partial sets (the functions run after every draw): certain verdicts return at once.
const pass = (n) => Array(n).fill('pass');
check('empty set -> pending, says 15 remain', [verdictOf({ draws: [] }), spike({ draws: [] }).reason], ['pending', '0/15 valid draws in, 15 remaining']);
check('14 clean draws -> pending (go needs all 15)', verdictOf({ draws: pass(14) }), 'pending');
check('2 failures in 2 draws -> no-go: p̂', verdictOf({ draws: ['fail', 'fail'] }), 'no-go: p̂');
check('1 failure in 3 draws, nothing else certain -> pending', verdictOf({ draws: ['fail', 'pass', 'pass'] }), 'pending');
check('1 failure in 14 draws -> pending; 2 in 14 -> no-go: p̂', [verdictOf({ draws: [...draws(1).slice(0, 14)] }), verdictOf({ draws: draws(2).slice(0, 14) })], ['pending', 'no-go: p̂']);
check('12 passes, 6 invalid seen -> inconclusive', verdictOf({ draws: pass(12), invalidSeen: 6 }), 'inconclusive');
check('12 passes, 5 invalid seen -> pending', verdictOf({ draws: pass(12), invalidSeen: 5 }), 'pending');
check('10 passes, spend 210 -> no-go: spend', verdictOf({ draws: pass(10), spendUsd: 210 }), 'no-go: spend');
check('10 passes, spend 208 -> pending', verdictOf({ draws: pass(10), spendUsd: 208 }), 'pending');
check('Stage 0 on a partial set -> no-go: stage0', verdictOf({ draws: pass(3), stage0Seen: true }), 'no-go: stage0');
check('partial no-go lists every certain failure, p̂ first', [spike({ draws: ['fail', 'fail', 'pass'], stage0Seen: true, spendUsd: 300 }).verdict, spike({ draws: ['fail', 'fail', 'pass'], stage0Seen: true, spendUsd: 300 }).reasons.length], ['no-go: p̂', 3]);
check('more than 15 draws -> null', [spike({ draws: pass(16) }), spike({ draws: draws(0).concat(['fail']) })], [null, null]);
check('money text rounds float noise: 0.1 + 0.2 renders as \$0.30', spike({ draws: pass(15), spendUsd: 0.1 + 0.2 }).reason.includes('spend \$0.30 <='), true);
check('money comparison stays on the raw value: 208.004 is over the cap', verdictOf({ spendUsd: 208.004 }), 'no-go: spend');
check('UNITS is frozen and pinned', [Object.isFrozen(UNITS), UNITS.join()], [true, 'ship-loop,code-loop']);
check('result shape', Object.keys(spike()), ['verdict', 'rule_id', 'reasons', 'reason']);

// NF2: P(go) = sum over failure counts k of pmf(k) * [spikeDecision says go]. The pmf is local
// (float Pascal's triangle, exact integer coefficients) and deliberately NOT imported from stats.mjs.
// The plan quotes 0.549 / 0.035 at +-0.001; the exact values are 0.54904 and 0.03527, so pin at 5e-4.
const choose = [1];
for (let n = 1; n <= 15; n++) { const prev = choose.slice(); for (let k = 1; k < n; k++) choose[k] = prev[k - 1] + prev[k]; choose[n] = 1; }
const pmf = (k, pPass) => choose[k] * (1 - pPass) ** k * pPass ** (15 - k);
const pGo = (p) => { let s = 0; for (let k = 0; k <= 15; k++) if (verdictOf({ draws: draws(k) }) === 'go') s += pmf(k, p); return s; };
for (const [p, want] of [[0.90, 0.549], [0.70, 0.035], [0.95, 0.829], [0.85, 0.319], [0.80, 0.167]]) {
  check('P(go) at p=' + p + ' is ' + want + ' +-0.0005 (via spikeDecision)', Math.abs(pGo(p) - want) <= 0.0005, true);
}
check('exact P(go) at p=0.90 is 0.54904 (5 d.p.)', pGo(0.90).toFixed(5), '0.54904');
check('exact P(go) at p=0.70 is 0.03527 (5 d.p.)', pGo(0.70).toFixed(5), '0.03527');

// FR-1a / FR-36 probe.
const d = (o = {}) => ({ costUsd: 3, durationMin: 10, resumeFailed: false, nonAnthropicHost: false, tokenHit: false, ...o });
const probe = (o = {}) => probeDecision({ draws: [d(), d(), d()], unit: 'ship-loop', invalidSeen: 0, ...o });
const pv = (o) => probe(o)?.verdict ?? null;
check('clean -> continue', pv(), 'continue');
check('cost \$8 exactly -> continue; \$8.01 -> stop', [pv({ draws: [d({ costUsd: 8 }), d(), d()] }), pv({ draws: [d({ costUsd: 8.01 }), d(), d()] })], ['continue', 'stop']);
check('probe partial: empty -> pending; 1 or 2 clean draws -> pending', [pv({ draws: [] }), pv({ draws: [d()] }), pv({ draws: [d(), d()] })], ['pending', 'pending', 'pending']);
check('probe partial: one draw over \$8 -> stop', pv({ draws: [d({ costUsd: 9 })] }), 'stop');
check('probe partial: 2 draws, 3 invalid seen -> stop; 2 invalid -> pending', [pv({ draws: [d(), d()], invalidSeen: 3 }), pv({ draws: [d(), d()], invalidSeen: 2 })], ['stop', 'pending']);
check('probe partial: 2 slow draws out of 2 -> switch; 1 slow of 2 -> pending', [pv({ draws: [d({ durationMin: 25 }), d({ durationMin: 25 })] }), pv({ draws: [d({ durationMin: 25 }), d()] })], ['switch', 'pending']);
check('probe partial: one 41-min draw alone -> switch; 40 -> pending', [pv({ draws: [d({ durationMin: 41 })] }), pv({ draws: [d({ durationMin: 40 })] })], ['switch', 'pending']);
check('probe partial: a switch under the fallback -> stop', pv({ draws: [d({ durationMin: 41 })], unit: 'code-loop' }), 'stop');
check('probe partial: stop flag beats a slow pair', pv({ draws: [d({ durationMin: 25, tokenHit: true }), d({ durationMin: 25 })] }), 'stop');
check('probe partial: 4 draws -> null', pv({ draws: [d(), d(), d(), d()] }), null);
check('\$8.01 draw and median 25 min -> stop (stop beats switch)', pv({ draws: [d({ costUsd: 8.01, durationMin: 25 }), d({ durationMin: 25 }), d({ durationMin: 25 })] }), 'stop');
check('\$8.01 draw and a 41-min draw -> stop', pv({ draws: [d({ costUsd: 8.01 }), d({ durationMin: 41 }), d()] }), 'stop');
check('median 20 exactly -> continue; 25 -> switch', [pv({ draws: [d({ durationMin: 20 }), d({ durationMin: 20 }), d({ durationMin: 20 })] }), pv({ draws: [d({ durationMin: 25 }), d({ durationMin: 25 }), d({ durationMin: 25 })] })], ['continue', 'switch']);
check('median 25, all <= \$8 -> switch', pv({ draws: [d({ durationMin: 25 }), d({ durationMin: 25 }), d({ durationMin: 30 })] }), 'switch');
check('max 41, median 10 -> switch', pv({ draws: [d({ durationMin: 41 }), d(), d()] }), 'switch');
check('max 40 exactly, median 10 -> continue', pv({ draws: [d({ durationMin: 40 }), d(), d()] }), 'continue');
check('a median over 20 needs two slow draws: one 30-min draw alone is continue', pv({ draws: [d({ durationMin: 30 }), d(), d()] }), 'continue');
check('median is order-independent', [pv({ draws: [d({ durationMin: 25 }), d({ durationMin: 25 }), d()] }), pv({ draws: [d(), d({ durationMin: 25 }), d({ durationMin: 25 })] })], ['switch', 'switch']);
for (const flag of ['resumeFailed', 'nonAnthropicHost', 'tokenHit']) {
  check(flag + ' -> stop', pv({ draws: [d({ [flag]: true }), d(), d()] }), 'stop');
  check(flag + ' + a 41-min draw -> stop (stop beats switch)', pv({ draws: [d({ [flag]: true, durationMin: 41 }), d(), d()] }), 'stop');
}
const slow = [d({ durationMin: 25 }), d({ durationMin: 25 }), d({ durationMin: 25 })];
check('switch under the primary unit -> switch; the same under the fallback -> stop', [pv({ draws: slow }), pv({ draws: slow, unit: 'code-loop' })], ['switch', 'stop']);
check('a 41-min draw under the fallback -> stop', pv({ draws: [d({ durationMin: 41 }), d(), d()], unit: 'code-loop' }), 'stop');
check('clean under the fallback -> continue', pv({ unit: 'code-loop' }), 'continue');
check('invalid replaced: 0, 2 -> continue; 3 -> stop', [0, 2, 3].map((n) => pv({ invalidSeen: n })), ['continue', 'continue', 'stop']);
check('a third invalid replacement stops even under the fallback', pv({ invalidSeen: 3, unit: 'code-loop' }), 'stop');
check('stop lists every stop reason', probe({ draws: [d({ costUsd: 9, resumeFailed: true }), d(), d()], invalidSeen: 3 }).reasons.length, 3);

// Malformed shapes -> null, never a throw and never a verdict.
const holes = new Array(15); for (let i = 0; i < 14; i++) holes[i] = 'pass';
const sparse = draws(0); delete sparse[4];
const proxied = new Proxy(draws(0), { get(t, k, r) { if (k === '2') throw new Error('boom'); return Reflect.get(t, k, r); } });
const thrower = new Proxy({}, { get() { throw new Error('boom'); } });
check('spike: sparse array / hole / Proxy getter -> null', [spike({ draws: sparse }), spike({ draws: holes }), safe(() => spike({ draws: proxied }))], [null, null, null]);
check('spike: 16 draws -> null', spike({ draws: [...draws(0), 'pass'] }), null);
check('spike: non-enum / invalid / non-array draws -> null', [spike({ draws: ['Pass', ...draws(0).slice(1)] }), spike({ draws: ['invalid', ...draws(0).slice(1)] }), spike({ draws: undefined }), spike({ draws: 'p'.repeat(15) })], [null, null, null, null]);
check('spike: non-boolean stage0Seen (missing, 0, \"false\", null) -> null', [undefined, 0, 'false', null].map((v) => spike({ stage0Seen: v })), [null, null, null, null]);
check('spike: bad spendUsd (missing, NaN, Infinity, negative, string) -> null', [undefined, NaN, Infinity, -1, '100'].map((v) => spike({ spendUsd: v })), [null, null, null, null, null]);
check('spike: bad invalidSeen (missing, negative, fractional, NaN, string) -> null', [undefined, -1, 1.5, NaN, '0'].map((v) => spike({ invalidSeen: v })), [null, null, null, null, null]);
check('spike: null / undefined / throwing input -> null', [safe(() => spikeDecision(null)), safe(() => spikeDecision(undefined)), safe(() => spikeDecision(thrower))], [null, null, null]);
const sparseProbe = [d(), d(), d()]; delete sparseProbe[1];
check('probe: 4 draws / sparse -> null', [pv({ draws: [d(), d(), d(), d()] }), pv({ draws: sparseProbe }), pv({ draws: new Array(3) })], [null, null, null]);
check('probe: non-boolean flags (missing, 1, \"true\") -> null', ['resumeFailed', 'nonAnthropicHost', 'tokenHit'].flatMap((f) => [undefined, 1, 'true'].map((v) => pv({ draws: [d({ [f]: v }), d(), d()] }))), Array(9).fill(null));
check('probe: bad costUsd / durationMin (missing, NaN, negative, string) -> null', ['costUsd', 'durationMin'].flatMap((f) => [undefined, NaN, -1, '5'].map((v) => pv({ draws: [d({ [f]: v }), d(), d()] }))), Array(8).fill(null));
check('probe: Infinity duration is not finite -> null', pv({ draws: [d({ durationMin: Infinity }), d(), d()] }), null);
check('probe: null / non-object draw -> null', [pv({ draws: [null, d(), d()] }), pv({ draws: ['x', d(), d()] })], [null, null]);
check('probe: bad unit -> null', [undefined, 'Ship-loop', 'plan'].map((u) => pv({ unit: u })), [null, null, null]);
check('probe: bad invalidSeen (missing, negative, fractional, string) -> null', [undefined, -1, 1.5, '0'].map((v) => pv({ invalidSeen: v })), [null, null, null, null]);
check('probe: null / throwing input / throwing draw -> null', [safe(() => probeDecision(null)), safe(() => probeDecision(thrower)), safe(() => probe({ draws: [new Proxy(d(), { get() { throw new Error('boom'); } }), d(), d()] }))], [null, null, null]);

// The array length is read once: a Proxy that reports an in-bounds length for the size cap and a larger
// one afterwards must not slip a 16th spike draw (or a 4th probe draw) past the cap.
const lenFlip = (arr, first, then) => { let c = 0; return new Proxy(arr, { get(t, k) { return k === 'length' ? (c++ === 0 ? first : then) : t[k]; } }); };
check('spike: length reported 15 then 16 -> null', spikeDecision({ draws: lenFlip(pass(16), 15, 16), spendUsd: 100, stage0Seen: false, invalidSeen: 0 }), null);
check('probe: length reported 3 then 4 -> null', probeDecision({ draws: lenFlip([d(), d(), d(), d()], 3, 4), unit: 'ship-loop', invalidSeen: 0 }), null);

// Each record is read once: a getter that flips between the validation read and the decision read
// must not reach \`continue\`.
const flip = (field, first, then) => { let calls = 0; const o = d(); Object.defineProperty(o, field, { get() { return calls++ === 0 ? first : then; } }); return o; };
check('probe: costUsd getter 9 then 3 is not continue', pv({ draws: [flip('costUsd', 9, 3), d(), d()] }) !== 'continue', true);
check('probe: tokenHit getter true then false is not continue', pv({ draws: [flip('tokenHit', true, false), d(), d()] }) !== 'continue', true);
check('probe: durationMin getter 41 then 10 is not continue', pv({ draws: [flip('durationMin', 41, 10), d(), d()] }) !== 'continue', true);

for (const [ok, name, got, want] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(want) + ', got ' + JSON.stringify(got) + ')'));
" 2>&1) || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"
ran=$((pass + fail))
[ "$ran" -ge 90 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 90 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
