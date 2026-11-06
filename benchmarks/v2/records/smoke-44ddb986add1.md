# Benchmark record: smoke

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 32 of 32. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare | 16 | 12 | 0.75 | 0.75 | 52684 | 0.114 | 0.7 | {"finished":16} |
| somi5 | 16 | 14 | 0.88 | 0.88 | 161889 | 0.164 | 1.6 | {"finished":16} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 2.94 (2.27 to 3.80) | 1.53 (1.25 to 1.86) | 2.26 (1.84 to 2.78) |

## Own tests

Tests each draw added or changed, run on the reference solution and on each of its recorded mutants.

| Arm | Draws with tests | Pass on the reference | Mutants killed |
|---|---|---|---|
| bare | 16 of 16 | 10 | 27 of 31 (87%) |
| somi5 | 16 of 16 | 7 | 20 of 22 (91%) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | {} | {"none":16} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0854} | {"main":39513} | 1.00 |
| somi5 | {"build":13,"debug":1,"refactor":1} | {"tool":16} | 0.44 | {} | 0 | 0 | {"Major":4,"Minor":13,"Nit":10} | {"claude-sonnet-5-5":0.1357,"claude-haiku-5-5":0.0076} | {"main":55570,"somi:somi-reviewer":9054,"unknown":17013,"somi:somi-security-reviewer":5585,"somi:somi-worker-low":54430} | 1.00 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
