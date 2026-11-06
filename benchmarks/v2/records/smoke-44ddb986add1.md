# Benchmark record: smoke

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 22 of 22. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare | 11 | 6 | 0.55 | 0.55 | 73508 | 0.158 | 0.9 | {"finished":11} |
| somi5 | 11 | 9 | 0.82 | 0.82 | 127726 | 0.174 | 1.3 | {"finished":11} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 2.14 (1.47 to 3.12) | 1.59 (1.28 to 1.96) | 1.81 (1.34 to 2.46) |

## Own tests

Tests each draw added or changed, run on the reference solution and on each of its recorded mutants.

| Arm | Draws with tests | Pass on the reference | Mutants killed |
|---|---|---|---|
| bare | 11 of 11 | 5 | 13 of 17 (76%) |
| somi5 | 11 of 11 | 5 | 16 of 17 (94%) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | {} | {"none":11} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.086} | {"main":40095} | 1.00 |
| somi5 | {"debug":1,"build":9} | {"tool":11} | 0.09 | {} | 0 | 0 | {"Minor":2,"Nit":2} | {"claude-sonnet-5-5":0.1388,"claude-haiku-5-5":0.0038} | {"main":57385,"somi:somi-security-reviewer":6593,"unknown":8675,"somi:somi-reviewer":13809,"somi:somi-worker-low":18041} | 1.00 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
