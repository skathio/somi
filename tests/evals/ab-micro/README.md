# Micro tasks — authoring standard

This directory is the corpus root of the micro-task suite: many small tasks with a high chance of failure, each costing a
few tenths of a dollar to draw. A task is a directory `<ID>/` plus a sibling `<ID>.mutants.json`, with the same layout as
`tests/evals/ab/` (`task.json`, `fixture/`, `hidden/`, `oracle/`, `oracle2/`). The template and a worked example are in
`tests/evals/ab-micro-template/` (outside this root, so it is never run as a task): copy `EXAMPLE/` and
`EXAMPLE.mutants.json`, then change the names. No real task is committed yet.

**Tier.** The test tier for this suite is the low tier. Every result it produces is a low-tier result: it says what the
review loop adds for a model of that size on small code, and says nothing about the same loop on a larger model.

## The statement (`task.json`)

- 5 to 8 numbered lines (the position in the list is the number; do not write numbers into the text). Each line is at most
  400 characters. The brief is at most 1200 characters.
- State the property, not the technique: what the result is, never how to compute it.
- Pin every tie-break, bound, inclusivity, rounding rule, error type and error code, and the order in which checks run when
  several inputs are wrong. If two reasonable readings exist, the statement is not finished.
- One named export in one file (`source` lists exactly one file), at most 60 production lines in the oracle, Node built-ins
  only. Tests, if the candidate writes any, go under `test/`.
- The task must size `small` deterministically: contained, testable, no open design question, no new surface that a planner
  would ask about.
- Words the lint refuses (the security floor and the first-stage triggers: authentication and authorization, login, cryptography,
  encryption, secrets, passwords, tokens, sessions, cookies, keys, personal data, e-mail, "untrusted input") and destructive
  SQL phrases anywhere in the task. The list is data in `tests/evals/lib/micro-lint.mjs`; a test checks it against the routing
  skill's wording. Model names are kept out by the stale-vocabulary gate.

## The hidden suite

- One named test per case, so `green / total` is a continuous score. Names are `AC<n> [family] <case-id>`: `<n>` is the
  statement the case checks, the family is a tag such as `functional`, `boundary` or `safety`.
- Cases are data: `hidden/cases.json` (60 to 120 cases for a real task; the example has 16). Arguments and expected values are
  JSON, with `{"$num": "NaN"}`, `{"$num": "-0"}`, `{"$num": "Infinity"}` and `{"$undef": 1}` for the values JSON cannot hold.
  An expectation is `{"value": X}` or `{"throws": {"name": "RangeError", "code": "E_X"}}`. Generate the table once with the
  brute-force oracle and commit it; the table is never generated at run time.
- Two shared files sit in `hidden/` of every task, copied byte for byte from the template apart from the first (canary)
  line: `run-family.mjs` (the runner child) and `cases.test.mjs` (the test file). Hidden suites may import only `node:`
  built-ins and only top-level files of `hidden/` are copied, which is why each task carries its own copy. The lint fails a
  copy that drifted.
- Execution: the test file starts ONE child per family with a timeout (`timeoutMs`, at most 30 s). The child loads the
  candidate once and prints one JSON line per case. A case that throws fails only itself. A child that hangs or dies fails every
  case of that family and no other family.
- Every file under `hidden/`, `oracle/` and `oracle2/` carries the task canary (`cases.json` as a `canary` field); nothing
  candidate-visible does.
- `oracle/` is the fast reference. `oracle2/` is an independent implementation by a different method (a brute force where one
  exists): both must score every case. Admission also needs the nop (the fixture alone) to fail every test.
- `<ID>.mutants.json` holds at least 6 plausible wrong solutions, `{name, file, find, replace}` against `oracle/`. The share of
  cases each one fails (the failed fraction) must be at least 5% and at most 90%, with at least one mutant in each of the bands
  5-20%, 20-40% and 40-60% (a mutant between 60% and 90% is allowed), so that a partial solution can land between 40% and 90%.
  A mutant that fails no case is equivalent and is reported by name. `tests/evals/lib/mutant-spread.mjs` checks this and
  `tests/scripts/eval-gate-micro-tasks.sh` runs it, with admission at 3 repeats, over every task here.

## Before a task counts

1. Admission with `admitTask(dir, {mutants, repeats: 3})` passes (oracle, oracle2, nop, mutants, stability) and the lint passes.
2. Ceiling probe: four independent cold agents at the low-cost tier, given only the statement and the fixture. A task where
   all four score 1.0 is a ceiling suspect: rewrite or drop it.
3. Cold review: a separate reviewer writes a solution from the statement alone and diffs it against the oracle on the case table.
   Every disagreement is resolved by editing the statement, then the probes run again for that task.
4. Calibration (separate draws, never reused as experiment draws) and sizing probes decide whether the task survives.

## Hook-confound rule

The pipeline's own hooks and gates can end or reroute a draw for reasons unrelated to code quality. A SoMi draw that the sizing
step does not rate `small`, or that stops before writing code, is a counted exclusion, not a loss, and the report shows the
reading with those pairs scored 0 next to it. A task whose draws are repeatedly stopped by a hook is dropped, not repaired
mid-experiment.

## What the suite can and cannot show

- It can show whether the review loop (independent review, fix, re-review) raises the score on small, well-specified code
  for a low-tier model, with paired tasks and an exact sign test.
- It cannot show anything about planning, design, security review or multi-file work; tasks avoid those on purpose.
- A null result on these tasks says the loop adds little here, not that it adds little elsewhere.
- The larger H1 task and its relatives are a separate corpus (`tests/evals/ab/`) and are not mixed into these results.
