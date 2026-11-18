# Benchmark record: smoke

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5, high tier claude-opus-5-5
- Rule hash: 137163faaadb36a4613bcba095f1b1ae49dc4e72ce848b3eabd8b927f2249dd0
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 192 of 192. Dollars are the CLI's estimate.

## Results first

Ranked by strict successes, then by correct work with valid tests, then by cost (within 10% is a tie). Tests are valid when the cases that pass on the reference solution kill at least 60% of its mutants; a case that fails on the reference does not count.

| Rank | Arm | Draws | Hidden tests pass | Own tests valid | Both | Quality gate | Strict successes | Mean dollars | On the cost front |
|---|---|---|---|---|---|---|---|---|---|
| 1 | somi5 | 96 | 89 | 69 | 64 | 96 | 64 | 0.200 | yes |
| 2 | bare | 96 | 73 | 67 | 58 | 81 | 53 | 0.087 | yes |

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare | 96 | 73 | n/a | n/a | 53267 | 0.115 | 0.6 | {"finished":96} |
| somi5 | 96 | 89 | n/a | n/a | 91270 | 0.216 | 1.1 | {"finished":94,"stopped-at-gate:open-blocking":2} |

## By segment

Each segment is reported on its own and has its own guard. Moves to the high tier are the draws that the high tier's model served in part.

| Segment | Arm | Tasks | Draws | Solved | Dollars per solved | Minutes per solved | Moves to the high tier |
|---|---|---|---|---|---|---|---|
| small | bare | 16 | 96 | 73 | 0.115 | 0.6 | 0 of 96 |
| small | somi5 | 16 | 96 | 89 | 0.216 | 1.1 | 42 of 96 |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 1.79 (1.45 to 2.23) | 1.88 (1.46 to 2.41) | 1.86 (1.50 to 2.31) |

## Own tests

Tests each draw added or changed, run case by case on the reference solution and on each of its recorded mutants. A case that fails on the reference pins something the reference does differently, often a detail the task leaves open, and is left out. Mutants are counted for draws with at least one agreeing case.

| Arm | Draws with tests | Cases agreeing with the reference | Mutants killed |
|---|---|---|---|
| bare | 96 of 96 | 407 of 481 (85%) | 387 of 638 (61%) |
| somi5 | 96 of 96 | 552 of 704 (78%) | 432 of 648 (67%) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | {} | {"none":96} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0873} | {"main":40505} | 1.00 |
| somi5 | {"build":5,"debug":2} | {"none":52,"tool":44} | 0.50 | {"open-blocking":2} | 0 | 1 | {"Minor":57,"Nit":57,"Major":14} | {"claude-sonnet-5-5":0.1341,"claude-opus-5-5":0.0661} | {"main":66367,"somi:somi-security-reviewer":14349,"unknown":3899} | 1.00 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
