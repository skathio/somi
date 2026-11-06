# Benchmark record: smoke

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 1 of 1. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| somi5-deliver | 1 | 1 | 1.00 | 1.00 | 2179844 | 1.614 | 6.1 | {"finished":1} |

## Own tests

Tests each draw added or changed, run on the reference solution and on each of its recorded mutants.

| Arm | Draws with tests | Pass on the reference | Mutants killed |
|---|---|---|---|
| somi5-deliver | 1 of 1 | 1 | 6 of 6 (100%) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| somi5-deliver | {"build":1} | {"tool":1} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":1.4727,"claude-haiku-5-5":0.1415} | {"unknown":557969,"main":227309} | 0.36 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
