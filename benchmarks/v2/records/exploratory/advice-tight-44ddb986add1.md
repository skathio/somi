# Benchmark record: tight

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 18 of 18. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare | 6 | 6 | 1.00 | 1.00 | 108240 | 0.240 | 1.3 | {"finished":6} |
| somi5 | 6 | 6 | 1.00 | 1.00 | 675697 | 0.377 | 6.2 | {"finished":6} |
| somi5-lane | 6 | 3 | 1.00 | 0.00 | 2103548 | 0.870 | 15.1 | {"finished":6} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 6.16 (2.26 to 16.79) | 1.05 (0.46 to 2.37) | 4.74 (1.97 to 11.43) |
| somi5-lane | 9.59 (5.34 to 17.23) | 1.45 (0.25 to 8.31) | 5.88 (3.56 to 9.71) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | {} | {"none":6} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.2403} | {"main":86683} | 0.59 |
| somi5 | {"build":3} | {"tool":6} | 0.67 | {} | 0 | 78 | {"Major":1,"Minor":6,"Nit":5} | {"claude-haiku-5-5":0.0568,"claude-sonnet-5-5":0.32} | {"somi:somi-security-reviewer":15136,"unknown":26361,"somi:somi-reviewer":59842,"main":233759,"somi:somi-worker-medium":109417} | 0.20 |
| somi5-lane | {"plan":5} | {"tool":6} | 0.17 | {} | 0 | 65 | {"Nit":1} | {"claude-haiku-5-5":0.0995,"claude-sonnet-5-5":0.3354} | {"somi:somi-worker-medium":74397,"unknown":39364,"main":223024,"somi:somi-security-reviewer":11546,"somi:somi-reviewer":55004} | 0.06 |

## Reading

Exploratory, 18 draws on the advice design at 1085bce, with the context squeezed so that each draw compacts. The plain SoMi arm solved 6 of 6 at $0.38 a draw, against 1 of 2, 0 of 6, 2 of 3 and 2 of 3 in the four earlier rounds on the step engine. The milestone arm solved 3 of 6 at $0.43, against 0 to 2 of 3 before. Bare solved 6 of 6 at $0.24. Six draws a side cannot show a difference from bare, only that the plain arm no longer loses here.
