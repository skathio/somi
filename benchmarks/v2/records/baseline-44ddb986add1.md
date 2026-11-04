# Benchmark record: baseline

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 192 of 192. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare | 96 | 73 | 0.69 | 0.50 | 54628 | 0.118 | 0.7 | {"finished":96} |
| somi41 | 96 | 63 | 0.63 | 0.19 | 1760081 | 3.162 | 9.8 | {"finished":94,"timed-out":2} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi41 | 19.42 (14.33 to 26.32) | 16.69 (12.55 to 22.21) | 8.53 (6.14 to 11.84) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Closed | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | {} | {"none":96} | 0 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0897} | {"main":40855} | 0.52 |
| somi41 | {} | {"none":96} | 0 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":2.08} | {"somi:somi-flow":333520,"unknown":445554,"main":91407,"somi:somi-designer":619} | 0.48 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
