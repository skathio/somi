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

Bare solved 73 of 96 at $0.118 per solved task and half a minute per draw. 4.1 solved 63 of 96 at $3.162 per solved task and 6.4 minutes per draw. Per draw, 4.1 cost 16.69 times bare in dollars (12.55 to 22.21), 19.42 times in tokens and 8.53 times in wall time. On these tasks 4.1's extra process did not buy more hidden tests passed.

The two invalid draws are 4.1 on N37, timed out at 30 minutes and $3.98 between them. I read draw 3: not hung. It hit the code loop's diff cap, which counted the earlier iteration's uncommitted changes, and the coordinator kept dispatching the flow again. 4.1 also failed N37's organisation isolation tests in the draws that did finish, so the timeout did not change the outcome for that task.

N02.somi41.2 was lost in flight at a pause and rerun. Its cost is correct; its weighted and spend fields were inflated by an append bug that has since been fixed.

Limits: these are 16 small tasks scored by hidden tests. A process can catch problems these tests do not check, so this does not measure all of what 4.1's review does.
