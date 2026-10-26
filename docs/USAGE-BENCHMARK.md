# Measuring a release: the usage and speed benchmark

How a maintainer decides, with recorded evidence, whether a release uses less context, runs faster or costs
less than the release it replaces. It is a per-release routine, not a per-commit check, and its output is a
committed report built from [`benchmarks/usage-speed/reports/TEMPLATE.md`](../benchmarks/usage-speed/reports/TEMPLATE.md).
A worked example (L0 and L1 only) is [`example-l0-l1.md`](../benchmarks/usage-speed/reports/example-l0-l1.md).

The instrument is three layers, one sealed rule and one comparison tool. Everything below is a command you run
by hand; nothing here runs in `npm test` or ships in the package.

| Layer | What it measures | Cost | Tool |
|---|---|---|---|
| L0 | Bytes of instruction and context text reaching a model, per standard scenario. Exact, host independent. | free | `tests/scripts/manual/usage-l0.mjs` |
| L1 | Local latency of hooks, scripts and one MCP round trip. At least 30 repeats; one host only. | free | `tests/scripts/manual/usage-l1.mjs` |
| L2 | Live paired draws (SoMi arm and a bare arm) for cost, time, turns and tokens, on the low tier. | paid | `tests/scripts/manual/usage-bench.mjs` |
| Compare | Two baseline files in, a verdict per metric out, under the sealed rule. | free | `tests/scripts/manual/usage-compare.mjs` |

The committed reference is [`baseline-1c32277.json`](../benchmarks/usage-speed/baseline-1c32277.json) (the 4.0.0
release candidate, [report](../benchmarks/usage-speed/reports/1c32277-vs-8c44e2d.md)). The first one,
[`baseline-8c44e2d.json`](../benchmarks/usage-speed/baseline-8c44e2d.json), was recorded on a model its alias no longer
resolves to, so it is kept as history only. Both are recorded
under rule version 1 ([`rule.json`](../benchmarks/usage-speed/rule.json)). The calibration run that fixed what
L2 can resolve is [`pilot/report.md`](../benchmarks/usage-speed/pilot/report.md).

## 1. When to run

Once per release that claims a usage or speed effect, after the release candidate is frozen. Not per commit:
a release comparison covers every change in the release at once, and a live L2 recording is a multi-hour,
paid, account-window-bound job (section 9). If the release makes no usage or speed claim, skip it.

## 2. Name one primary metric per change, before measuring

Write down, for each change the release claims as an improvement, the single metric that would show it. Do
this before any candidate number exists, and put it in the report (the template makes it a required field,
with the date it was chosen). Other metrics are still printed, but they cannot produce the headline "better";
a change that helps one metric and is judged on another is the multiple-comparison trap the rule exists to
prevent.

The `--primary` argument of the compare tool takes one of these names:

| `--primary` | Layer | Verdict computed on |
|---|---|---|
| `bytes` | L0 | absolute bytes, SoMi side, exact |
| `ms` | L1 | absolute median milliseconds, same host fingerprint |
| `time`, `cost` | L2 | overhead ratio (SoMi median over bare median) per scenario, pooled by geometric mean |
| `tokens`, `turns` | L2 | absolute SoMi-arm ratio of medians |

Pick the metric that matches the claim: a smaller injected prompt is `bytes`; a faster hook is `ms`; "fewer
turns" is `turns`. A claim smaller than L2 can resolve (section 8) must be shown at L0 or L1, and the report
says L2 could not see it.

## 3. Order of work

1. L0 for every release. It is free, exact and takes seconds.
2. L1 when the release touches hooks, scripts, the MCP server or session start.
3. L2 only when the release claims a change in behaviour, turns, tokens, cost or end-to-end time. Do not run
   L2 to look for a regression nobody claimed, and do not run it for a claim L0 or L1 already settles.

Anything not measured is carried as "not measured" in the report. It is not filled with an older number.

## 4. Record the candidate baseline

A baseline is one JSON file per commit, checked by the schema in
[`tests/evals/lib/bench-schema.mjs`](../tests/evals/lib/bench-schema.mjs): git SHA, plugin version, rule
version and hash, model alias and tier, pin-all flag, host fingerprint, the scenario list, the L0 bytes, the L1
samples and the L2 rows. The compare tool checks it on load and refuses an invalid one.

### 4.0 Set up

Use a worktree of the candidate commit so the measured tree is exactly that commit and nothing else:

```bash
git worktree add ../bench-candidate <candidate-sha>
cd ../bench-candidate
git status --short          # must print nothing
```

The candidate must contain the benchmark tooling (it does for every commit after the instrument landed). Run
every command below from that worktree, on the same machine that recorded the baseline you will compare with.
Close other heavy sessions first: L1 timing and the account window are both shared with whatever else runs.

For L2 you also need the low-tier model alias the baseline used (read it from the baseline's `model.alias`; it
is data, not something to guess), and the eval token file described in section 10.

### 4.1 L0 (free)

```bash
node tests/scripts/manual/usage-l0.mjs --json > l0.json
```

Exit 0 printed, 64 usage error, 65 a measurement was refused (a missing file, a hook that failed, a zero-byte
scenario). The result is the same on any host.

### 4.2 L1 (free)

```bash
node tests/scripts/manual/usage-l1.mjs --json > l1.json
```

Defaults to 30 runs per event after one discarded warm-up; fewer than the rule's minimum is refused (exit 64).
Exit 1 means an event itself failed. The output carries the host fingerprint the compare tool uses to refuse
L1 across machines.

### 4.3 L2 (paid, only with the user's go-ahead)

Never start a paid draw without the user's explicit go-ahead for that run, a stated budget, and a stated
cap. See section 10.

Build the plugin directory from the candidate commit without the test tree, because the driver refuses a
plugin that carries `tests/evals` or `.somi`:

```bash
PLUGIN=$(mktemp -d)
git archive --format=tar <candidate-sha> -- . ':(exclude)tests' ':(exclude)benchmarks' | tar -x -C "$PLUGIN"
```

The driver refuses a `--budget-total` below the worst case of the draws still to run (the sum of the per-draw
caps), and `--force-budget` is not an acceptable way around that. Run the plan in one-repeat chunks per
scenario instead, so each chunk's worst case fits its budget. A scenario pair (SoMi arm cap $6 plus bare arm cap $2 by default) needs `--budget-total 8` or more:

```bash
for seed in 1 2 3 4 5 6 7 8; do
  for scenario in S1 S2 S3; do
    node tests/scripts/manual/usage-bench.mjs --model ALIAS --phase experiment \
      --scenarios "$scenario" --repeats 1 --seed "$seed" --budget-total 8 \
      --plugin-dir "$PLUGIN" --out "$HOME/bench-runs/$scenario-$seed"
  done
done
```

`ALIAS` is the same model alias as the baseline. Before the first real chunk, check one with `--plan-only`
instead of spending: it prints the plan, the worst case and the cost configuration, and makes no model call.
The committed baseline was recorded as 24 such chunks (seeds 1 to 8, three scenarios), with eight repeats per
scenario and arm.

What the driver enforces for you: one draw at a time, both arms at the low ceiling with every agent pinned, a
model in the stream that is not the pinned alias makes the row invalid, `calibration`, `sizing` and
`experiment` rows never mix in one `--out`, and a re-run into the same `--out` skips finished draws. Exit
codes: 0 every planned draw has a terminal row, 1 halted (the reason is printed), 130 interrupted.

The baseline needs all planned draws. A halted chunk is not a loss: re-run the same command after the halt
reason clears (section 9).

### 4.4 Turn the outputs into a baseline file

Assemble the baseline from `l0.json`, `l1.json` and every chunk's `results.jsonl`. Only entries with status
`done` carry a row. Save this as a scratch file outside the repository, for example `assemble-baseline.mjs`:

```js
// node assemble-baseline.mjs ROOT LIKE.json L0.json L1.json OUT.json ALIAS TIER [results.jsonl ...]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const [root, likeFile, l0File, l1File, outFile, alias, tier, ...rowFiles] = process.argv.slice(2);
const { baselineProblems } = await import(`${root}/tests/evals/lib/bench-schema.mjs`);
const { loadRule } = await import(`${root}/tests/evals/lib/bench-rule.mjs`);
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const rule = loadRule(`${root}/benchmarks/usage-speed/rule.json`);
const like = read(likeFile);                      // the baseline you will compare with: scenarios and pinAll must match it
const l0 = read(l0File);
const l1 = read(l1File);
const rows = rowFiles
  .flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)))
  .filter((entry) => entry.status === 'done')
  .map((entry) => entry.row);

const baseline = {
  schema: 1,
  sha: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pluginVersion: read(`${root}/.claude-plugin/plugin.json`).version,
  date: new Date().toISOString().slice(0, 10),
  rule: { version: rule.rule.version, hash: rule.hash },
  model: { alias, tier },
  pinAll: like.pinAll,
  host: l1.host,
  scenarios: like.scenarios,
  L0: l0.L0,
  L1: l1.L1,
  L2: { rows },
};
const problems = baselineProblems(baseline, { repoRoot: root });
if (problems.length > 0) { console.error(problems.join('\n')); process.exit(1); }
fs.writeFileSync(outFile, `${JSON.stringify(baseline, null, 1)}\n`);
console.log(`wrote ${outFile}: ${rows.length} L2 row(s), ${Object.keys(baseline.L1.events).length} L1 events`);
```

```bash
node assemble-baseline.mjs "$PWD" benchmarks/usage-speed/baseline-8c44e2d.json l0.json l1.json \
  candidate.json ALIAS low "$HOME"/bench-runs/*/results.jsonl
```

`baselineProblems` is the same check the compare tool runs, including the scan that refuses any token-like
string, long encoded run, home path or repository path in the file. A failure prints reasons and writes
nothing. Review the file once before committing it: no hostname, user name or path should be in it, and
the host block should be the six fingerprint keys only.

When only L0 and L1 were measured, pass no `results.jsonl`: the L2 rows are then empty and the L2 metrics
read "not comparable" (section 5). Do not copy the older baseline's rows into the candidate; that would
present a measurement that was not taken.

Commit the candidate baseline under `benchmarks/usage-speed/` as `baseline-<short-sha>.json`.

## 5. Compare

```bash
node tests/scripts/manual/usage-compare.mjs candidate.json benchmarks/usage-speed/baseline-8c44e2d.json --primary bytes
```

The candidate is first, the baseline second. Exit codes:

| Exit | Meaning |
|---|---|
| 0 | A verdict was printed. Read the verdict line; "inconclusive" is a normal, exit-0 outcome. |
| 64 | Usage error, or the comparison was refused (the `REFUSED:` line says why): different rule hash, model alias, tier, scenario or event list, pin-all flag, rows from a phase other than `experiment`, or a primary metric with no data. |
| 65 | Invalid input: an unreadable or non-JSON file, a baseline that fails the schema or the secret scan, or an unloadable rule. |

Verdicts, per the sealed rule: `better` or `worse` only when the whole 90% bootstrap interval of the ratio lies
beyond the layer's minimum effect; otherwise `inconclusive`. `inconclusive-guarded` means the quality
non-inferiority guard tripped on a would-be "better". `inconclusive-drift` means the secondary basis points the
opposite way. Minimum effects (from `rule.json`): L0 1%; L1 10% with at least 30 repeats; L2 30% in time and
20% in cost, tokens and turns. A metric the tool cannot compute prints `not-comparable` with the reason; that is
different from `inconclusive`, which means it was computed and the interval was too wide or too close to zero.

Run the compare once with the primary metric you named in section 2, and keep that output for the report. Run it
for the other layers too if you want their lines on record, but a headline comes only from the primary.

## 6. When to re-record instead of compare

Re-record the baseline you compare against (a paid, multi-hour job) when any of these changes:

- the model alias or tier, even if the alias still resolves: the tool refuses and says re-record;
- the host (CPU, core count, rounded memory, OS release, node version) for L1 and for wall time. L0 is exact on
  any host, and the tool applies the host check to L1 and wall time only;
- a scenario or its fixture (the task text, hidden suite, or scenario list);
- the rule version. A new rule hash means every earlier baseline is stale: earlier verdicts must be re-run or
  marked superseded.

## 7. Who may change the rule

Only the user, as a recorded decision, as a new rule version, followed by a re-recorded baseline under that
version. Nobody edits `rule.json` in place, loosens a minimum effect to make a result clear, or adds a scenario
to the pooled ratio after seeing numbers. The rule hash is stored in every baseline and the compare tool refuses
mismatches, so an in-place edit invalidates every committed baseline rather than rescuing a result.

## 8. What this system can and cannot conclude

Can:

- L0: any change in injected bytes is real and exact; the verdict applies at a 1% minimum effect. It says
  nothing about tokens billed or about behaviour.
- L1: a change of about 10% in a hook or script latency, on the same host fingerprint, from at least 30 repeats.
- L2: large changes only. The calibration run showed live noise too high for the registered minimum effects at
  eight repeats per arm; per [`pilot/report.md`](../benchmarks/usage-speed/pilot/report.md), live L2 resolves
  roughly a 50% or larger change in cost or time, and only on the scenarios that run stably (S1 and S3).

Cannot:

- S2 (the full ship-loop task) is distribution-only. It stays in the baseline and the quality guard, but not
  in any pooled ratio; the SoMi arm there is bimodal (a full run or an early stop). The report shows its draw
  counts and green medians instead of a ratio.
- Quality equality. Quality enters only as a coarse flag: the candidate's hidden-suite median falling more than
  0.20 below the baseline's, or invalid or zero draws rising by more than 0.25. The flag can turn a "better"
  into "inconclusive-guarded"; it never creates a win, and a drop under about 0.20 is not detected.
- A verdict on a higher model tier. Context-size effects transfer in direction; sizing and other behaviour
  effects do not. Every verdict is labelled with its tier.
- L1 or wall time across hosts, or after an alias change. The tool refuses.
- A per-change verdict, unless the report names one primary metric per change.

## 9. Account-window schedule, halt and resume

Live draws share the account's rolling usage window with every other session on it. Plan the recording as a
sequence of windows, not a single sitting:

- One draw at a time, never in parallel. SoMi-arm draws are the long ones: in the committed baseline the 24
  SoMi draws sum to about 3.3 hours of draw time and the 24 bare draws to about 1.2 hours.
- No other heavy agent session runs during a recording.
- The driver halts when the account limit is reached and prints the reset text. Wait for the reset and re-run
  the same chunk command into the same `--out`: finished draws are skipped, the interrupted one runs again from
  the start, and halted attempts are not counted as rows. The same holds for the other halt reasons it names
  (a background-wait ceiling, an auth failure, a budget stop).
- The draw order is seeded and interleaves arms and scenarios, so a partial run stays balanced.

## 10. Safety

- Never expose the eval token. It lives in an untracked env file (`.somi/eval.env` by default; override with
  `--env-file`). Do not print it, paste it into a prompt, a report or a commit message, pass it on a command
  line, or put the file anywhere that is tracked. The driver hands it to the child process only and keeps it
  out of rows, logs and kept files; the baseline schema check refuses a token-like string. If a token
  ever appears in an output, treat it as leaked and rotate it.
- Never run paid draws without the user's go-ahead for that specific run: the scenario set, the chunk plan and
  the total budget. A previous approval does not carry over to the next release. State the worst case
  (`--plan-only` prints it) before asking.
- Do not weaken the driver's guards to fit a budget: no `--force-budget`, no `--unsafe-no-sandbox`, no
  unpinned models.
- `--out` directories hold full transcripts of the draws; keep them outside the repository and do not commit
  them. Only the assembled baseline file is committed.

For scale (from the committed files, not a quote): the 48 L2 rows of the baseline record $23.25 of cost, $17.85
on the SoMi arm and $5.40 on the bare arm; halted attempts add to the account spend but not to the rows, and
the calibration run spent more than its rows show for the same reason
([`pilot/report.md`](../benchmarks/usage-speed/pilot/report.md), "Spend"). Cost varies with the model's price
and the release's behaviour, so state the budget fresh each time.

## 11. The evidence report

Copy [`benchmarks/usage-speed/reports/TEMPLATE.md`](../benchmarks/usage-speed/reports/TEMPLATE.md) to
`benchmarks/usage-speed/reports/<candidate-short-sha>-vs-<baseline-short-sha>.md` and fill every required
field. The report is the committed evidence; it must carry:

- both baselines' full SHAs and plugin versions, the rule version and hash, the model alias and tier, the
  host fingerprint, and the date;
- the primary metric per change, chosen before measuring;
- a verdict table with one row per layer, including layers that were not measured (marked "not measured");
- the guard status, the distribution-only scenarios, and the limits block.

`tests/scripts/eval-gate-bench-docs.sh` checks that the template names every required field and that the
example report cites two SHAs and the rule hash of the shipped rule.

## 12. Limitations

- Per release, not per commit: a result covers every change in the release together.
- Live L2 sees only large effects; most optimisations are small and are shown at L0 and L1 only.
- One account, one host, one low-tier model alias per baseline. A change in any of them re-records.
- The calibration run that sized the repeats used two draws per cell, so its noise estimates are rough
  (a factor of about two either way).
- L1 absolute numbers are per host and are not comparable between machines or after an operating-system or
  runtime upgrade.
- A "not measured" layer stays unmeasured; it is never inferred from another layer.
