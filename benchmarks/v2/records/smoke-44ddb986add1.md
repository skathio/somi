# Benchmark record: smoke

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 8 of 8. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare | 4 | 4 | 1.00 | 1.00 | 105866 | 0.209 | 1.3 | {"finished":4} |
| somi5-deliver | 4 | 2 | 0.50 | 0.50 | 1960676 | 1.579 | 15.9 | {"finished":4} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5-deliver | 9.48 (6.27 to 14.33) | 3.81 (2.36 to 6.15) | 6.17 (4.38 to 8.70) |

## Own tests

Tests each draw added or changed, run on the reference solution and on each of its recorded mutants.

| Arm | Draws with tests | Pass on the reference | Mutants killed |
|---|---|---|---|
| bare | 4 of 4 | 3 | 17 of 17 (100%) |
| somi5-deliver | 4 of 4 | 0 | n/a |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | {} | {"none":4} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.2091} | {"main":105866} | 1.00 |
| somi5-deliver | {"build":4} | {"tool":4} | 3.75 | {} | 0 | 0 | {"Minor":7,"Nit":4} | {"claude-sonnet-5-5":0.7302,"claude-haiku-5-5":0.0593} | {"unknown":787309,"main":177130,"somi:somi-security-reviewer":6744,"somi:somi-reviewer":9155} | 1.00 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
