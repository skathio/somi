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

5.0 does not pass the release rule. `bench.mjs decide` returned `ships: false` for three reasons, and all three stand:

- Solved rate: 70 of 96 against bare's 73. The mean difference is -0.031, but the lower bound of -0.2035 is just past the -0.2 margin.
- Hidden-test share: the mean difference is -0.050 and the lower bound of -0.156 is past the -0.05 margin.
- Dollars per solved task: 1.789 times bare against a limit of 1.5.

Against 4.1 it is a large improvement: 0.088 times the dollars per draw (0.063 to 0.125) and 0.227 times the tokens (0.168 to 0.307), with more tasks solved. Bare did not drift between recordings (0.989, 0.928 to 1.054). Across the 96 draws there were no inline writes.

Where the shortfall comes from, from the transcripts:

- Cost: the 48 draws where a reviewer ran cost $0.232 each, the 48 where none ran $0.076. Those groups differ in task, so read the ablation record for the clean comparison.
- Quality: the low-tier worker. In N10, Haiku wrote `async function extractBundle` beside a synchronous sibling in 5 of 6 draws, and the hidden tests call it synchronously, so those draws score 1 of 15. Bare wrote it synchronously in all six. In N11, bare's Sonnet hashed the reset token without being asked, while Haiku stored it in plain text, and the Haiku reviewer rated that Minor, so nothing re-looped. In the same task the security reviewer did find the surviving sessions and older tokens, and they were fixed, so review is doing real work there.
- Haiku is only about 9% of 5.0's spend, so the low tier saves little.

Two defects seen while reading, not yet fixed because the code is frozen for this recording: the commit subject can be just "Implement the following in this repository.", taken from the ticket's first line, and workers report "not committed" as if it were a problem, because the commit happens later at close.
