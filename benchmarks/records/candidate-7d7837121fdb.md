# Benchmark record: candidate

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 7d7837121fdbff7ee96e4e2e19e685f724dee10daf55cbd0177a064eb12add52
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 112 of 112. Dollars are the CLI's estimate.

## Results first

Ranked by strict successes, then by correct work with valid tests, then by cost (within 10% is a tie). Tests are valid when the cases that pass on the reference solution kill at least 60% of its mutants; a case that fails on the reference does not count.

| Rank | Arm | Draws | Hidden tests pass | Own tests valid | Both | Quality gate | Strict successes | Mean dollars | On the cost front |
|---|---|---|---|---|---|---|---|---|---|
| 1 | somi5 | 96 | 90 | 66 | 62 | 96 | 62 | 0.141 | yes |
| 2 | bare-check | 16 | 13 | 9 | 8 | 15 | 7 | 0.089 | yes |

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare-check | 16 | 13 | 0.81 | 0.81 | 51602 | 0.110 | 0.7 | {"finished":16} |
| somi5 | 96 | 90 | 1.00 | 0.75 | 74857 | 0.150 | 1.1 | {"finished":96} |

## Against bare-check

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 1.51 (1.25 to 1.82) | 1.44 (1.22 to 1.70) | 1.55 (1.31 to 1.84) |

## Own tests

Tests each draw added or changed, run case by case on the reference solution and on each of its recorded mutants. A case that fails on the reference pins something the reference does differently, often a detail the task leaves open, and is left out. Mutants are counted for draws with at least one agreeing case.

| Arm | Draws with tests | Cases agreeing with the reference | Mutants killed |
|---|---|---|---|
| bare-check | 16 of 16 | 64 of 78 (82%) | 49 of 103 (48%) |
| somi5 | 96 of 96 | 464 of 573 (81%) | 391 of 643 (61%) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare-check | {} | {"none":16} | 0.00 | {} | 0 | 1 | {} | {"claude-sonnet-5-5":0.0892} | {"main":41927} | 1.00 |
| somi5 | {"build":4} | {"none":46,"tool":50} | 0.53 | {} | 0 | 1 | {"Minor":60,"Nit":37,"Major":9,"Blocker":1} | {"claude-sonnet-5-5":0.1407} | {"main":58426,"somi:somi-security-reviewer":5844,"unknown":5907} | 1.00 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
