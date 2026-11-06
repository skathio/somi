# Benchmark record: smoke

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 6 of 6. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare | 3 | 3 | 1.00 | 1.00 | 36831 | 0.079 | 0.5 | {"finished":3} |
| somi5 | 3 | 3 | 1.00 | 1.00 | 136224 | 0.200 | 1.2 | {"finished":3} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 3.69 (2.83 to 4.81) | 2.49 (1.70 to 3.65) | 2.47 (2.25 to 2.70) |

## Own tests

Tests each draw added or changed, run on the reference solution and on each of its recorded mutants.

| Arm | Draws with tests | Pass on the reference | Mutants killed |
|---|---|---|---|
| bare | 3 of 3 | 2 | 5 of 5 (100%) |
| somi5 | 3 of 3 | 1 | 3 of 3 (100%) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | {} | {"none":3} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0795} | {"main":36831} | 1.00 |
| somi5 | {"build":2} | {"tool":3} | 0.67 | {} | 0 | 1 | {"Minor":4,"Major":1,"Nit":3} | {"claude-sonnet-5-5":0.1956,"claude-haiku-5-5":0.0044} | {"somi:somi-security-reviewer":11916,"unknown":28627,"somi:somi-reviewer":24490,"main":71191} | 1.00 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
