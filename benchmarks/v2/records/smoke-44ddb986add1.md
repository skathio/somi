# Benchmark record: smoke

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 8 of 8. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare | 4 | 4 | 1.00 | 1.00 | 328757 | 0.673 | 1.5 | {"finished":4} |
| somi5 | 4 | 3 | 0.75 | 0.75 | 823806 | 1.088 | 3.3 | {"finished":4} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 1.71 (0.83 to 3.54) | 1.20 (0.91 to 1.58) | 1.52 (0.81 to 2.86) |

## Own tests

Tests each draw added or changed, run on the reference solution and on each of its recorded mutants.

| Arm | Draws with tests | Pass on the reference | Mutants killed |
|---|---|---|---|
| bare | 4 of 4 | 3 | 17 of 17 (100%) |
| somi5 | 4 of 4 | 2 | 11 of 11 (100%) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | {} | {"none":4} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.6731} | {"main":107977} | 0.30 |
| somi5 | {"build":4} | {"tool":4} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.7933,"claude-haiku-5-5":0.023} | {"somi:somi-worker-low":95871,"unknown":7264,"main":131274} | 0.30 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
