# Benchmark record: ablation

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 7d7837121fdbff7ee96e4e2e19e685f724dee10daf55cbd0177a064eb12add52
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 160 of 160. Dollars are the CLI's estimate.

## Results first

Ranked by strict successes, then by correct work with valid tests, then by cost (within 10% is a tie). Tests are valid when the cases that pass on the reference solution kill at least 60% of its mutants; a case that fails on the reference does not count.

| Rank | Arm | Draws | Hidden tests pass | Own tests valid | Both | Quality gate | Strict successes | Mean dollars | On the cost front |
|---|---|---|---|---|---|---|---|---|---|
| 1 | abl-review-always | 16 | 15 | 14 | 14 | 16 | 14 | 0.236 | yes |
| 2 | abl-review-off-planning-on | 16 | 14 | 13 | 13 | 16 | 13 | 0.095 | yes |
| 3 | abl-review-off | 16 | 14 | 12 | 11 | 16 | 11 | 0.101 | no |
| 4 | abl-digest-off | 16 | 13 | 12 | 11 | 16 | 11 | 0.157 | no |
| 5 | abl-digest-off-planning-on | 16 | 12 | 13 | 11 | 16 | 11 | 0.167 | no |
| 6 | abl-planning-on | 16 | 14 | 12 | 11 | 16 | 11 | 0.161 | no |
| 7 | somi5 | 16 | 15 | 12 | 11 | 16 | 11 | 0.178 | no |
| 8 | bare | 16 | 13 | 12 | 11 | 13 | 10 | 0.091 | yes |
| 9 | abl-review-off-digest-off | 16 | 13 | 9 | 9 | 16 | 9 | 0.096 | no |
| 10 | abl-review-off-digest-off-planning-on | 16 | 11 | 12 | 9 | 16 | 9 | 0.092 | no |

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| abl-digest-off | 16 | 13 | 0.81 | 0.81 | 96066 | 0.193 | 1.0 | {"finished":16} |
| abl-digest-off-planning-on | 16 | 12 | 0.75 | 0.75 | 111394 | 0.223 | 1.2 | {"finished":16} |
| abl-planning-on | 16 | 14 | 0.88 | 0.88 | 91798 | 0.185 | 1.0 | {"finished":16} |
| abl-review-always | 16 | 15 | 0.94 | 0.94 | 127969 | 0.251 | 1.3 | {"finished":16} |
| abl-review-off | 16 | 14 | 0.88 | 0.88 | 54187 | 0.115 | 0.7 | {"finished":16} |
| abl-review-off-digest-off | 16 | 13 | 0.81 | 0.81 | 55982 | 0.119 | 0.7 | {"finished":16} |
| abl-review-off-digest-off-planning-on | 16 | 11 | 0.69 | 0.69 | 63582 | 0.134 | 0.8 | {"finished":16} |
| abl-review-off-planning-on | 16 | 14 | 0.88 | 0.88 | 51074 | 0.109 | 0.6 | {"finished":16} |
| bare | 16 | 13 | 0.81 | 0.81 | 51394 | 0.111 | 0.6 | {"finished":16} |
| somi5 | 16 | 15 | 0.94 | 0.94 | 95621 | 0.190 | 1.0 | {"finished":16} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| abl-digest-off | 1.60 (1.29 to 2.00) | 1.51 (1.24 to 1.85) | 1.45 (1.22 to 1.73) |
| abl-digest-off-planning-on | 1.62 (1.25 to 2.09) | 1.54 (1.22 to 1.94) | 1.50 (1.22 to 1.84) |
| abl-planning-on | 1.68 (1.35 to 2.09) | 1.58 (1.30 to 1.93) | 1.51 (1.27 to 1.79) |
| abl-review-always | 2.80 (2.51 to 3.12) | 2.53 (2.27 to 2.82) | 2.30 (2.14 to 2.48) |
| abl-review-off | 1.13 (1.03 to 1.24) | 1.11 (1.02 to 1.20) | 1.18 (1.07 to 1.30) |
| abl-review-off-digest-off | 1.10 (1.00 to 1.20) | 1.07 (0.99 to 1.15) | 1.12 (1.03 to 1.22) |
| abl-review-off-digest-off-planning-on | 1.02 (0.93 to 1.11) | 0.99 (0.92 to 1.07) | 1.08 (0.99 to 1.17) |
| abl-review-off-planning-on | 1.07 (0.99 to 1.15) | 1.05 (0.98 to 1.12) | 1.08 (1.01 to 1.16) |
| somi5 | 1.75 (1.36 to 2.26) | 1.66 (1.32 to 2.09) | 1.59 (1.32 to 1.93) |

## Own tests

Tests each draw added or changed, run case by case on the reference solution and on each of its recorded mutants. A case that fails on the reference pins something the reference does differently, often a detail the task leaves open, and is left out. Mutants are counted for draws with at least one agreeing case.

| Arm | Draws with tests | Cases agreeing with the reference | Mutants killed |
|---|---|---|---|
| abl-digest-off | 16 of 16 | 75 of 92 (82%) | 74 of 108 (69%) |
| abl-digest-off-planning-on | 16 of 16 | 70 of 88 (80%) | 63 of 108 (58%) |
| abl-planning-on | 16 of 16 | 77 of 97 (79%) | 72 of 108 (67%) |
| abl-review-always | 16 of 16 | 86 of 101 (85%) | 76 of 108 (70%) |
| abl-review-off | 16 of 16 | 77 of 93 (83%) | 66 of 108 (61%) |
| abl-review-off-digest-off | 16 of 16 | 78 of 93 (84%) | 54 of 108 (50%) |
| abl-review-off-digest-off-planning-on | 16 of 16 | 71 of 86 (83%) | 68 of 108 (63%) |
| abl-review-off-planning-on | 16 of 16 | 80 of 95 (84%) | 71 of 108 (66%) |
| bare | 16 of 16 | 61 of 74 (82%) | 61 of 103 (59%) |
| somi5 | 16 of 16 | 87 of 108 (81%) | 70 of 108 (65%) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| abl-digest-off | {"build":6,"debug":1} | {"none":6,"tool":10} | 0.44 | {} | 0 | 0 | {"Nit":13,"Minor":12,"Major":1} | {"claude-sonnet-5-5":0.1567} | {"main":58646,"somi:somi-reviewer":5910,"unknown":9761,"somi:somi-security-reviewer":3737} | 1.00 |
| abl-digest-off-planning-on | {"build":9} | {"none":4,"tool":12} | 0.50 | {} | 0 | 0 | {"Nit":16,"Minor":9,"Major":2} | {"claude-sonnet-5-5":0.1673} | {"main":59133,"somi:somi-security-reviewer":6280,"unknown":10660,"somi:somi-reviewer":7473} | 1.00 |
| abl-planning-on | {"build":5} | {"none":6,"tool":10} | 0.44 | {} | 0 | 0 | {"Nit":12,"Minor":12} | {"claude-sonnet-5-5":0.1615} | {"main":62628,"somi:somi-reviewer":6297,"unknown":7302,"somi:somi-security-reviewer":4096} | 1.00 |
| abl-review-always | {"build":8} | {"tool":16} | 1.13 | {} | 0 | 0 | {"Minor":19,"Nit":28,"Major":2} | {"claude-sonnet-5-5":0.2356} | {"somi:somi-reviewer":17136,"unknown":17358,"main":79866,"somi:somi-security-reviewer":5611} | 1.00 |
| abl-review-off | {"build":3,"debug":1} | {"none":11,"tool":5} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.1008} | {"main":47413} | 1.00 |
| abl-review-off-digest-off | {"build":4,"debug":1} | {"none":10,"tool":6} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0963} | {"main":45486} | 1.00 |
| abl-review-off-digest-off-planning-on | {"build":5,"debug":1} | {"none":10,"tool":6} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0924} | {"main":43713} | 1.00 |
| abl-review-off-planning-on | {"build":6,"debug":1} | {"none":9,"tool":7} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.095} | {"main":44690} | 1.00 |
| bare | {} | {"none":16} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0905} | {"main":41758} | 1.00 |
| somi5 | {"build":6} | {"none":5,"tool":11} | 0.56 | {} | 0 | 1 | {"Minor":15,"Nit":17,"Blocker":1,"Major":1} | {"claude-sonnet-5-5":0.1782} | {"main":65553,"somi:somi-security-reviewer":6347,"unknown":8817,"somi:somi-reviewer":8927} | 1.00 |

## Reading

To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.
