# Hand-written candidates (scorer-side)

Fixtures for `tests/scripts/eval-runner.sh`, exercising `scoreExpiryGuard()` in
[`../../run.mjs`](../../run.mjs). **Not candidate-visible** — these are what a `/code` run's output
would look like, written by hand so 3.4b's executor can be tested without invoking a model.

Each is a full copy of `task02-code/` with `src/auth/token.mjs` and `tests/auth/token.test.mjs`
replaced. They are deliberately *not* generated from `task02-code/` at test time: the point is to
pin three specific outcomes, and a generator that drifted with the fixture would stop pinning them.

| directory | what it represents | expected verdict |
|---|---|---|
| `correct-guard/` | fixes expiry, adds a test that asserts rejection | `pass` |
| `no-expiry-test/` | fixes expiry, but its new test never checks expiry | `fail` — green on the mutant |
| `changed-surface/` | fixes expiry, renames the export despite R3 | `non-attributable` |

`changed-surface/` exists because the frozen references cannot load against a renamed export, so
the suite goes red from a module error rather than an assertion. Grading that as "the guard worked"
would pass a test that never checks expiry. It is recorded as neither pass nor fail so phase 4 can
tell a corpus defect from a definition-set regression.
