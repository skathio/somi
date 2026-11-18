# Benchmark record: smoke

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 7d7837121fdbff7ee96e4e2e19e685f724dee10daf55cbd0177a064eb12add52
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 34 of 36. Dollars are the CLI's estimate.

## Results first

Ranked by strict successes, then by correct work with valid tests, then by cost (within 10% is a tie). Tests are valid when the cases that pass on the reference solution kill at least 60% of its mutants; a case that fails on the reference does not count.

| Rank | Arm | Draws | Hidden tests pass | Own tests valid | Both | Quality gate | Strict successes | Mean dollars | On the cost front |
|---|---|---|---|---|---|---|---|---|---|
| 1 | somi5 | 17 | 12 | 10 | 10 | 17 | 10 | 0.288 | yes |
| 2 | bare | 17 | 9 | 4 | 4 | 9 | 1 | 0.129 | yes |

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare | 17 | 9 | n/a | n/a | 113990 | 0.244 | 1.5 | {"finished":17} |
| somi5 | 17 | 12 | n/a | n/a | 203885 | 0.408 | 2.2 | {"finished":17} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 2.21 (0.88 to 5.53) | 2.08 (0.89 to 4.85) | 1.93 (1.07 to 3.47) |

## Own tests

Tests each draw added or changed, run case by case on the reference solution and on each of its recorded mutants. A case that fails on the reference pins something the reference does differently, often a detail the task leaves open, and is left out. Mutants are counted for draws with at least one agreeing case.

| Arm | Draws with tests | Cases agreeing with the reference | Mutants killed |
|---|---|---|---|
| bare | 17 of 17 | 77 of 135 (57%) | 153 of 375 (41%) |
| somi5 | 17 of 17 | 100 of 140 (71%) | 205 of 375 (55%) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | {} | {"none":17} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.1292} | {"main":60348} | 1.00 |
| somi5 | {"build":14} | {"tool":17} | 0.76 | {} | 0 | 2 | {"Major":4,"Minor":25,"Nit":30} | {"claude-sonnet-5-5":0.2883} | {"somi:somi-security-reviewer":7604,"unknown":19644,"somi:somi-reviewer":15958,"main":100713} | 1.00 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
