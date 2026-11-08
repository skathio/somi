# Benchmark record: smoke

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 16 of 16. Dollars are the CLI's estimate.

## Results first

Ranked by strict successes, then by correct work with valid tests, then by cost (within 10% is a tie). Valid tests pass on the reference solution and kill at least 60% of its mutants.

| Rank | Arm | Draws | Hidden tests pass | Own tests valid | Both | Quality gate | Strict successes | Mean dollars | On the cost front |
|---|---|---|---|---|---|---|---|---|---|
| 1 | bare | 4 | 2 | 3 | 2 | 3 | 2 | 0.118 | yes |
| 2 | somi5-deliver | 4 | 2 | 3 | 2 | 4 | 2 | 0.532 | no |
| 3 | somi5 | 4 | 3 | 2 | 1 | 4 | 1 | 0.270 | no |
| 4 | somi5-hooks | 4 | 3 | 1 | 1 | 4 | 1 | 0.347 | no |

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare | 4 | 2 | 0.50 | 0.50 | 111925 | 0.236 | 1.4 | {"finished":4} |
| somi5 | 4 | 3 | 0.75 | 0.75 | 183132 | 0.360 | 2.2 | {"finished":4} |
| somi5-deliver | 4 | 2 | 0.50 | 0.50 | 768511 | 1.065 | 6.5 | {"finished":4} |
| somi5-hooks | 4 | 3 | 0.75 | 0.75 | 238485 | 0.463 | 2.3 | {"finished":4} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 2.25 (1.30 to 3.90) | 2.12 (1.27 to 3.54) | 2.19 (1.64 to 2.92) |
| somi5-deliver | 5.96 (4.17 to 8.51) | 3.86 (2.54 to 5.88) | 3.81 (2.44 to 5.96) |
| somi5-hooks | 2.64 (1.39 to 5.03) | 2.48 (1.35 to 4.55) | 2.22 (1.51 to 3.27) |

## Own tests

Tests each draw added or changed, run on the reference solution and on each of its recorded mutants.

| Arm | Draws with tests | Pass on the reference | Mutants killed |
|---|---|---|---|
| bare | 4 of 4 | 3 | 10 of 11 (91%) |
| somi5 | 4 of 4 | 2 | 8 of 9 (89%) |
| somi5-deliver | 4 of 4 | 3 | 11 of 11 (100%) |
| somi5-hooks | 4 of 4 | 1 | 6 of 6 (100%) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | {} | {"none":4} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.1178} | {"main":55962} | 1.00 |
| somi5 | {"build":1} | {"tool":4} | 1.00 | {} | 0 | 0 | {"Nit":6,"Minor":8,"Major":1} | {"claude-sonnet-5-5":0.2699} | {"main":96704,"somi:somi-reviewer":13533,"unknown":18289,"somi:somi-security-reviewer":8823} | 1.00 |
| somi5-deliver | {"build":4} | {"tool":4} | 1.25 | {} | 0 | 1 | {"Minor":6,"Nit":3} | {"claude-sonnet-5-5":0.5211,"claude-haiku-5-5":0.0113} | {"unknown":295491,"main":88764} | 1.00 |
| somi5-hooks | {} | {"none":1,"tool":3} | 1.25 | {} | 0 | 0 | {"Minor":8,"Nit":11} | {"claude-sonnet-5-5":0.3471} | {"main":116983,"somi:somi-security-reviewer":13152,"unknown":22978,"somi:somi-reviewer":25751} | 1.00 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
