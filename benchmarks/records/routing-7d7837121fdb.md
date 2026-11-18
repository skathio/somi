# Benchmark record: routing

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 7d7837121fdbff7ee96e4e2e19e685f724dee10daf55cbd0177a064eb12add52
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 42 of 42. Dollars are the CLI's estimate.

## Results first

Ranked by strict successes, then by correct work with valid tests, then by cost (within 10% is a tie). Tests are valid when the cases that pass on the reference solution kill at least 60% of its mutants; a case that fails on the reference does not count.

| Rank | Arm | Draws | Hidden tests pass | Own tests valid | Both | Quality gate | Strict successes | Mean dollars | On the cost front |
|---|---|---|---|---|---|---|---|---|---|
| 1 | somi5 | 21 | 21 | 18 | 18 | 21 | 18 | 0.110 | yes |
| 2 | bare | 21 | 21 | 18 | 18 | 16 | 16 | 0.076 | yes |

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare | 21 | 21 | 1.00 | 1.00 | 35872 | 0.076 | 0.6 | {"finished":21} |
| somi5 | 21 | 21 | 1.00 | 1.00 | 54382 | 0.110 | 0.8 | {"finished":21} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 1.39 (1.08 to 1.80) | 1.36 (1.08 to 1.70) | 1.32 (1.05 to 1.66) |

## Own tests

Tests each draw added or changed, run case by case on the reference solution and on each of its recorded mutants. A case that fails on the reference pins something the reference does differently, often a detail the task leaves open, and is left out. Mutants are counted for draws with at least one agreeing case.

| Arm | Draws with tests | Cases agreeing with the reference | Mutants killed |
|---|---|---|---|
| bare | 21 of 21 | 95 of 96 (99%) | 47 of 57 (82%) |
| somi5 | 21 of 21 | 104 of 109 (95%) | 50 of 57 (88%) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | {} | {"none":21} | 0.00 | {} | 0 | 2 | {} | {"claude-sonnet-5-5":0.076} | {"main":35872} | 1.00 |
| somi5 | {"build":2} | {"none":12,"tool":9} | 0.38 | {} | 0 | 4 | {"Minor":3,"Nit":5} | {"claude-sonnet-5-5":0.1105} | {"main":45685,"somi:somi-security-reviewer":5450,"unknown":3247} | 1.00 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
