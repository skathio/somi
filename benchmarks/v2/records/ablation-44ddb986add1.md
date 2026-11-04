# Benchmark record: ablation

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 160 of 160. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| abl-digest-off | 16 | 12 | 0.75 | 0.75 | 217925 | 0.150 | 2.0 | {"finished":16} |
| abl-digest-off-planning-on | 16 | 12 | 0.75 | 0.75 | 278686 | 0.179 | 2.6 | {"finished":16} |
| abl-planning-on | 16 | 9 | 0.56 | 0.56 | 344260 | 0.229 | 3.2 | {"finished":16} |
| abl-review-always | 16 | 10 | 0.63 | 0.63 | 339796 | 0.244 | 3.3 | {"finished":16} |
| abl-review-off | 16 | 13 | 0.81 | 0.81 | 152513 | 0.096 | 1.6 | {"finished":16} |
| abl-review-off-digest-off | 16 | 11 | 0.69 | 0.69 | 171973 | 0.119 | 1.7 | {"finished":16} |
| abl-review-off-digest-off-planning-on | 16 | 11 | 0.69 | 0.69 | 185011 | 0.103 | 2.0 | {"finished":16} |
| abl-review-off-planning-on | 16 | 11 | 0.69 | 0.69 | 196694 | 0.105 | 1.9 | {"finished":16} |
| bare | 16 | 12 | 0.75 | 0.75 | 55756 | 0.120 | 0.6 | {"finished":16} |
| somi5 | 16 | 11 | 0.69 | 0.69 | 243277 | 0.195 | 2.3 | {"finished":16} |

## Against bare

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| abl-digest-off | 3.70 (3.17 to 4.31) | 1.19 (0.96 to 1.46) | 3.15 (2.75 to 3.60) |
| abl-digest-off-planning-on | 4.44 (3.55 to 5.56) | 1.26 (0.95 to 1.67) | 3.88 (3.15 to 4.79) |
| abl-planning-on | 4.29 (3.59 to 5.12) | 1.31 (1.05 to 1.63) | 3.64 (3.02 to 4.38) |
| abl-review-always | 5.16 (4.52 to 5.90) | 1.69 (1.37 to 2.08) | 4.41 (3.68 to 5.28) |
| abl-review-off | 2.90 (2.59 to 3.26) | 0.89 (0.79 to 1.02) | 2.66 (2.22 to 3.18) |
| abl-review-off-digest-off | 2.77 (2.45 to 3.13) | 0.91 (0.80 to 1.04) | 2.48 (2.11 to 2.91) |
| abl-review-off-digest-off-planning-on | 2.96 (2.57 to 3.40) | 0.81 (0.72 to 0.90) | 2.79 (2.31 to 3.38) |
| abl-review-off-planning-on | 3.24 (2.94 to 3.58) | 0.84 (0.75 to 0.93) | 2.82 (2.48 to 3.22) |
| somi5 | 3.80 (3.22 to 4.48) | 1.32 (1.01 to 1.73) | 3.37 (2.88 to 3.94) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Closed | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| abl-digest-off | {"build":16} | {"tool":16} | 15 | 0.44 | {} | 0 | 0 | {"Minor":15,"Nit":8,"Major":3} | {"claude-sonnet-5-5":0.1012,"claude-haiku-5-5":0.0113} | {"somi:somi-reviewer":11716,"unknown":14520,"somi:somi-worker":88698,"main":41262,"somi:somi-security-reviewer":7247} | 1.00 |
| abl-digest-off-planning-on | {"build":16} | {"tool":16} | 16 | 0.56 | {} | 0 | 0 | {"Minor":19,"Nit":10,"Major":1} | {"claude-sonnet-5-5":0.1198,"claude-haiku-5-5":0.0148} | {"somi:somi-worker":107104,"unknown":17967,"somi:somi-reviewer":18534,"main":44995,"somi:somi-security-reviewer":8110} | 0.67 |
| abl-planning-on | {"build":16} | {"tool":16} | 16 | 0.63 | {} | 0 | 0 | {"Minor":19,"Nit":15,"Major":4} | {"claude-sonnet-5-5":0.1151,"claude-haiku-5-5":0.0136} | {"somi:somi-reviewer":17265,"unknown":17919,"somi:somi-worker":104747,"main":45879,"somi:somi-security-reviewer":7836} | 1.00 |
| abl-review-always | {"build":15,"debug":1} | {"tool":16} | 16 | 1.13 | {} | 0 | 0 | {"Major":11,"Minor":25,"Nit":11} | {"claude-sonnet-5-5":0.1384,"claude-haiku-5-5":0.0141} | {"somi:somi-worker":93514,"unknown":23115,"somi:somi-reviewer":30915,"main":56296,"somi:somi-security-reviewer":8531} | 1.00 |
| abl-review-off | {"debug":1,"build":15} | {"tool":16} | 16 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0691,"claude-haiku-5-5":0.0091} | {"somi:somi-worker":88006,"unknown":5321,"main":30590} | 1.00 |
| abl-review-off-digest-off | {"debug":2,"build":14} | {"tool":16} | 16 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0732,"claude-haiku-5-5":0.0083} | {"somi:somi-worker":83310,"unknown":5176,"main":29745} | 1.00 |
| abl-review-off-digest-off-planning-on | {"perf":1,"build":15} | {"tool":16} | 16 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0609,"claude-haiku-5-5":0.0098} | {"somi:somi-worker":94471,"unknown":5369,"main":27355} | 1.00 |
| abl-review-off-planning-on | {"build":16} | {"tool":16} | 16 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0618,"claude-haiku-5-5":0.0106} | {"somi:somi-worker":100733,"unknown":5379,"main":29115} | 1.00 |
| bare | {} | {"none":16} | 0 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0901} | {"main":41817} | 1.00 |
| somi5 | {"build":15,"debug":1} | {"tool":16} | 14 | 0.38 | {} | 0 | 0 | {"Major":6,"Minor":10,"Nit":4} | {"claude-sonnet-5-5":0.1239,"claude-haiku-5-5":0.0104} | {"somi:somi-worker":85023,"unknown":16655,"somi:somi-reviewer":9971,"main":45712,"somi:somi-security-reviewer":9892} | 1.00 |

## Reading

One draw per task and cell, so this reads main effects across 64 draws a side, not single cells. Across the eight factorial cells:

| Part | With: solved, share, $ per draw | Without: solved, share, $ per draw |
|---|---|---|
| Review on signals | 44/64, 0.913, $0.128 | 46/64, 0.916, $0.076 |
| Digest | 44/64, 0.911, $0.103 | 46/64, 0.918, $0.100 |
| Planning step | 43/64, 0.911, $0.102 | 47/64, 0.918, $0.102 |

- Review costs 68% more per draw and 33% more minutes, and shows no gain on the hidden tests. This is the clean version of the cost split in the candidate record.
- Always-on review solved 10 of 16 at $0.153 per draw, so more review did not raise the score.
- The digest and the planning step cost little and show no gain. A gap of 2 to 4 draws out of 64 is well inside the noise floor, so this does not show that they harm either.
- Review off alone solved 13 of 16 at 0.89 times bare's dollars (0.79 to 1.02). That is a single cell and it did not go through the release rule.

Reading this fairly: the hidden tests only see what they were written to check. Reviewers reported real problems the tests do not reward, such as a rollback that deletes overwritten files in N10 and a non-atomic idempotency key in N02. So this says review does not pay on these tests. It does not say review finds nothing. Most misses across the factorial, 24 of 38, are N10, N11 and H4, in every cell. Bare also fails H4 but mostly solves N10 and N11, which points at the worker rather than at any of these parts.
