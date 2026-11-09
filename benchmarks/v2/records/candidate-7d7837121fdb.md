# Benchmark record: candidate

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 7d7837121fdbff7ee96e4e2e19e685f724dee10daf55cbd0177a064eb12add52
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 112 of 112. Dollars are the CLI's estimate.

## Results first

Ranked by strict successes, then by correct work with valid tests, then by cost (within 10% is a tie). Tests are valid when the cases that pass on the reference solution kill at least 60% of its mutants; a case that fails on the reference does not count.

| Rank | Arm | Draws | Hidden tests pass | Own tests valid | Both | Quality gate | Strict successes | Mean dollars | On the cost front |
|---|---|---|---|---|---|---|---|---|---|
| 1 | somi5 | 96 | 82 | 62 | 55 | 96 | 55 | 0.175 | yes |
| 2 | bare-check | 16 | 13 | 10 | 8 | 15 | 8 | 0.086 | yes |

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare-check | 16 | 13 | 0.81 | 0.81 | 50124 | 0.106 | 0.7 | {"finished":16} |
| somi5 | 96 | 82 | 0.94 | 0.63 | 102514 | 0.205 | 1.1 | {"finished":96} |

## Against bare-check

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 1.79 (1.42 to 2.27) | 1.73 (1.39 to 2.14) | 1.54 (1.25 to 1.88) |

## Own tests

Tests each draw added or changed, run case by case on the reference solution and on each of its recorded mutants. A case that fails on the reference pins something the reference does differently, often a detail the task leaves open, and is left out. Mutants are counted for draws with at least one agreeing case.

| Arm | Draws with tests | Cases agreeing with the reference | Mutants killed |
|---|---|---|---|
| bare-check | 16 of 16 | 68 of 79 (86%) | 71 of 108 (66%) |
| somi5 | 96 of 96 | 505 of 621 (81%) | 381 of 648 (59%) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare-check | {} | {"none":16} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0865} | {"main":40726} | 1.00 |
| somi5 | {"build":53,"debug":1} | {"none":26,"tool":70} | 0.50 | {} | 0 | 4 | {"Nit":78,"Minor":58,"Major":9} | {"claude-sonnet-5-5":0.1749} | {"main":64337,"somi:somi-security-reviewer":6216,"unknown":8911,"somi:somi-reviewer":8099} | 1.00 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
