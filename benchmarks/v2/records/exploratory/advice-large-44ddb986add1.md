# Benchmark record: large

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 6 of 6. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| somi5 | 3 | 3 | n/a | n/a | 799455 | 0.266 | 6.3 | {"finished":3} |
| somi5-lane | 3 | 3 | n/a | n/a | 792940 | 0.517 | 6.3 | {"finished":3} |

## Against somi5

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5-lane | 1.59 (0.46 to 5.47) | 1.10 (0.06 to 20.50) | 1.38 (0.45 to 4.22) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| somi5 | {"build":2} | {"tool":3} | 0.33 | {} | 0 | 6 | {"Minor":1,"Nit":3} | {"claude-haiku-5-5":0.0782,"claude-sonnet-5-5":0.1874} | {"somi:somi-worker-medium":58532,"unknown":28462,"main":53294,"somi:somi-reviewer":102542,"somi:somi-security-reviewer":30244} | 0.23 |
| somi5-lane | {"plan":1} | {"tool":3} | 0.33 | {} | 0 | 28 | {"Minor":3,"Nit":2} | {"claude-haiku-5-5":0.0604,"claude-sonnet-5-5":0.4562} | {"somi:somi-worker-medium":201576,"unknown":40039,"main":178373,"somi:somi-security-reviewer":8776,"somi:somi-reviewer":49998} | 0.40 |

## Reading

Exploratory, one draw per task and arm on the advice design at 1085bce, without the 4.1 arm, whose results are already recorded. Both SoMi arms solved all three large tasks. The plain arm cost $0.14, $0.24 and $0.41 against $0.14, $0.57 and $1.39 on the step engine, and the milestone arm $0.53, $0.04 and $0.99 against $0.75, $0.83 and $4.20. Bare solved all three in the earlier round at $0.14 to $0.30. Three draws per arm show no failure, and nothing more.
