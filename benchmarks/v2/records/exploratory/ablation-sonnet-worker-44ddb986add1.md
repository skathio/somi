# Exploratory record: ablation with a Sonnet worker

Not part of the release decision. The registered ablation pins the low tier to Haiku. This one runs the same code, tasks and cells with the low tier mapped to Sonnet, to see what the worker model does. It was chosen after seeing the candidate result, so it is a second look and proves nothing on its own.

- Session model: claude-sonnet-5-5, low tier claude-sonnet-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 160 of 160. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| abl-digest-off | 16 | 12 | 0.75 | 0.75 | 137791 | 0.262 | 1.3 | {"finished":16} |
| abl-digest-off-planning-on | 16 | 11 | 0.69 | 0.69 | 149923 | 0.282 | 1.7 | {"finished":16} |
| abl-planning-on | 16 | 12 | 0.75 | 0.75 | 132319 | 0.251 | 1.3 | {"finished":16} |
| abl-review-always | 16 | 13 | 0.81 | 0.81 | 167995 | 0.311 | 1.6 | {"finished":16} |
| abl-review-off | 16 | 12 | 0.75 | 0.75 | 91107 | 0.178 | 1.0 | {"finished":16} |
| abl-review-off-digest-off | 16 | 12 | 0.75 | 0.75 | 93335 | 0.180 | 1.0 | {"finished":16} |
| abl-review-off-digest-off-planning-on | 16 | 9 | 0.56 | 0.56 | 124222 | 0.236 | 1.3 | {"finished":16} |
| abl-review-off-planning-on | 16 | 10 | 0.63 | 0.63 | 114727 | 0.218 | 1.2 | {"finished":16} |
| bare | 16 | 12 | 0.75 | 0.75 | 55882 | 0.120 | 0.6 | {"finished":16} |
| somi5 | 16 | 12 | 0.75 | 0.75 | 162755 | 0.306 | 1.4 | {"finished":16} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| abl-digest-off | 2.38 (2.08 to 2.73) | 2.12 (1.87 to 2.41) | 2.11 (1.89 to 2.36) |
| abl-digest-off-planning-on | 2.28 (1.89 to 2.74) | 2.01 (1.69 to 2.40) | 2.17 (1.69 to 2.78) |
| abl-planning-on | 2.25 (1.95 to 2.61) | 2.01 (1.76 to 2.30) | 2.03 (1.75 to 2.36) |
| abl-review-always | 3.21 (2.69 to 3.83) | 2.79 (2.36 to 3.29) | 2.68 (2.28 to 3.15) |
| abl-review-off | 1.66 (1.55 to 1.78) | 1.52 (1.43 to 1.62) | 1.57 (1.45 to 1.71) |
| abl-review-off-digest-off | 1.70 (1.57 to 1.85) | 1.54 (1.43 to 1.66) | 1.64 (1.47 to 1.83) |
| abl-review-off-digest-off-planning-on | 1.68 (1.55 to 1.82) | 1.50 (1.39 to 1.61) | 1.60 (1.47 to 1.74) |
| abl-review-off-planning-on | 1.71 (1.57 to 1.87) | 1.53 (1.42 to 1.65) | 1.59 (1.46 to 1.74) |
| somi5 | 2.50 (1.99 to 3.14) | 2.23 (1.80 to 2.77) | 2.08 (1.74 to 2.50) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Closed | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| abl-digest-off | {"build":15,"debug":1} | {"tool":16} | 14 | 0.44 | {} | 0 | 0 | {"Major":2,"Minor":14,"Nit":9} | {"claude-sonnet-5-5":0.1963} | {"somi:somi-worker":36195,"unknown":13859,"somi:somi-reviewer":5959,"main":42633,"somi:somi-security-reviewer":4697} | 1.00 |
| abl-digest-off-planning-on | {"build":16} | {"tool":16} | 16 | 0.56 | {} | 0 | 0 | {"Major":4,"Minor":8,"Nit":10} | {"claude-sonnet-5-5":0.1935} | {"somi:somi-reviewer":7769,"unknown":12248,"somi:somi-worker":36686,"main":41330,"somi:somi-security-reviewer":5038} | 1.00 |
| abl-planning-on | {"build":15,"debug":1} | {"tool":16} | 15 | 0.44 | {} | 0 | 0 | {"Minor":9,"Nit":11} | {"claude-sonnet-5-5":0.1885} | {"somi:somi-reviewer":6563,"unknown":11580,"somi:somi-worker":34787,"main":41840,"somi:somi-security-reviewer":4470} | 1.00 |
| abl-review-always | {"debug":2,"build":14} | {"tool":16} | 16 | 1.13 | {} | 0 | 0 | {"Minor":15,"Nit":18,"Major":2} | {"claude-sonnet-5-5":0.253} | {"somi:somi-reviewer":12278,"unknown":20710,"somi:somi-worker":40438,"main":56189,"somi:somi-security-reviewer":6882} | 1.00 |
| abl-review-off | {"build":16} | {"tool":16} | 16 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.1337} | {"somi:somi-worker":32905,"unknown":4699,"main":30726} | 1.00 |
| abl-review-off-digest-off | {"build":15,"debug":1} | {"tool":16} | 16 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.1351} | {"somi:somi-worker":36399,"unknown":3872,"main":29730} | 1.00 |
| abl-review-off-digest-off-planning-on | {"build":15,"debug":1} | {"tool":16} | 16 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.1327} | {"somi:somi-worker":37916,"unknown":4133,"main":27826} | 1.00 |
| abl-review-off-planning-on | {"debug":2,"build":14} | {"tool":16} | 16 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.1362} | {"somi:somi-worker":38284,"unknown":4170,"main":29250} | 1.00 |
| bare | {} | {"none":16} | 0 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0897} | {"main":41911} | 1.00 |
| somi5 | {"build":15,"debug":1} | {"tool":16} | 16 | 0.56 | {} | 0 | 0 | {"Major":2,"Minor":11,"Nit":13} | {"claude-sonnet-5-5":0.2296} | {"somi:somi-worker":37254,"unknown":13486,"somi:somi-reviewer":6715,"main":48242,"somi:somi-security-reviewer":6817} | 0.62 |

## Reading

The worker model decides most of the hidden-test share, and moving it to Sonnet costs far more than the 9% of spend Haiku showed. Across the eight factorial cells, 128 draws each:

| Low tier | Solved | Hidden-test share | Dollars per draw | Minutes per draw | Failed tests: safety, boundary, functional |
|---|---|---|---|---|---|
| Haiku | 90 | 0.915 | $0.102 | 1.5 | 103, 41, 26 |
| Sonnet | 90 | 0.978 | $0.168 | 0.9 | 48, 1, 3 |
| Bare, 32 draws across both | 24 | 0.983 | $0.090 | 0.5 | 9, 0, 3 |

- Sonnet closes nearly all of the share gap to bare and is faster than Haiku. It uses 40% fewer tokens per draw, 268,000 against 445,000, but costs 1.66 times as much because each token costs more. The solved count does not move: across the eight cells Sonnet gains draws on N02, N04, N10, N11 and N12 and loses some on H1, N17, N22, N37 and N09, mostly by one failed test.
- With a Sonnet worker, review with signals solved 47 of 64 at 0.982 share and $0.202 per draw. Without review it solved 43 of 64 at 0.975 and $0.134. That is a small gain inside the noise floor for 1.5 times the dollars. No review gain showed under Haiku, so the reviewer may have more to work with on better code, but one draw per cell cannot settle that.
- Even with no review, a Sonnet worker costs 1.52 times bare per draw (1.43 to 1.62): that is the cost of a coordinator plus a worker on the same model.
- Haiku matched or beat Sonnet on 11 of the 16 tasks, at a lower cost. It lost on N02, N04, N10, N11 and N12, which handle money, accounts or untrusted input. No fixed choice wins everywhere.

One draw halted on an account limit at 21:55 and was rerun; its partial row is not counted, and the recording resumed 30 minutes later. Usage at the end was 61% of the 5-hour window and 68% weekly, so that stop came from somewhere other than those two limits, and I did not find the cause.
