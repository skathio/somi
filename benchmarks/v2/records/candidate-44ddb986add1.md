# Benchmark record: candidate

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 112 of 112. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare-check | 16 | 12 | 0.75 | 0.75 | 54606 | 0.117 | 0.8 | {"finished":16} |
| somi5 | 96 | 70 | 0.69 | 0.56 | 286261 | 0.211 | 3.2 | {"finished":96} |

## Against bare-check

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 4.41 (3.61 to 5.39) | 1.49 (1.15 to 1.94) | 3.66 (3.10 to 4.32) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Closed | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare-check | {} | {"none":16} | 0 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0875} | {"main":40955} | 1.00 |
| somi5 | {"debug":4,"build":91,"perf":1} | {"tool":96} | 90 | 0.52 | {"worker-blocked":2} | 0 | 0 | {"Major":24,"Minor":95,"Nit":55} | {"claude-sonnet-5-5":0.1422,"claude-haiku-5-5":0.0137} | {"somi:somi-reviewer":18243,"unknown":18383,"somi:somi-worker":98902,"main":50360,"somi:somi-security-reviewer":8777} | 0.53 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
