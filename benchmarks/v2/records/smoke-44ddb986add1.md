# Benchmark record: smoke

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 8 of 8. Dollars are the CLI's estimate.

## Results first

Ranked by strict successes, then by correct work with valid tests, then by cost (within 10% is a tie). Valid tests pass on the reference solution and kill at least 60% of its mutants.

| Rank | Arm | Draws | Hidden tests pass | Own tests valid | Both | Quality gate | Strict successes | Mean dollars | On the cost front |
|---|---|---|---|---|---|---|---|---|---|
| 1 | bare | 4 | 4 | 3 | 3 | 3 | 2 | 0.197 | yes |
| 2 | somi5-deliver | 4 | 3 | 3 | 2 | 4 | 2 | 0.743 | no |

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare | 4 | 4 | 1.00 | 1.00 | 99059 | 0.197 | 1.4 | {"finished":4} |
| somi5-deliver | 4 | 3 | 0.75 | 0.75 | 1189459 | 0.990 | 10.2 | {"finished":4} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5-deliver | 9.01 (8.24 to 9.86) | 3.78 (3.23 to 4.43) | 5.61 (5.01 to 6.29) |

## Own tests

Tests each draw added or changed, run on the reference solution and on each of its recorded mutants.

| Arm | Draws with tests | Pass on the reference | Mutants killed |
|---|---|---|---|
| bare | 4 of 4 | 3 | 17 of 17 (100%) |
| somi5-deliver | 4 of 4 | 3 | 17 of 17 (100%) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | {} | {"none":4} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.1967} | {"main":99059} | 1.00 |
| somi5-deliver | {"build":4} | {"tool":4} | 3.75 | {} | 0 | 0 | {"Minor":3,"Nit":3} | {"claude-sonnet-5-5":0.69,"claude-haiku-5-5":0.0528} | {"unknown":723820,"main":168275} | 1.00 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
