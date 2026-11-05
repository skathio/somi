# Benchmark record: second candidate

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 112 of 112. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare-check | 16 | 14 | 0.88 | 0.88 | 46118 | 0.099 | 0.5 | {"finished":16} |
| somi5 | 96 | 71 | 0.75 | 0.50 | 228580 | 0.277 | 2.1 | {"finished":96} |

## Against bare-check

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 3.13 (2.42 to 4.05) | 1.93 (1.59 to 2.35) | 2.84 (2.28 to 3.55) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Closed | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare-check | {} | {"none":16} | 0 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0867} | {"main":40353} | 1.00 |
| somi5 | {"build":92,"debug":4} | {"tool":96} | 95 | 0.49 | {"max-passes":2,"worker-blocked":1} | 0 | 0 | {"Major":21,"Minor":94,"Nit":64,"Blocker":2} | {"claude-sonnet-5-5":0.1985,"claude-haiku-5-5":0.0065} | {"somi:somi-worker":61831,"unknown":15565,"main":48115,"somi:somi-security-reviewer":6628,"somi:somi-reviewer":14854} | 0.28 |

## Reading

The second candidate does not pass the release rule. `bench.mjs decide` returned `ships: false` for one reason: dollars per solved task are 2.35 times bare, against a limit of 1.5. Both quality checks now pass.

- Solved rate: 71 of 96 against bare's 73. The mean difference is -0.021 and the lower bound of -0.183 is inside the -0.2 margin.
- Hidden-test share: the mean difference is -0.004 and the lower bound of -0.019 is inside the -0.05 margin.
- Dollars per solved task: $0.277 against bare's $0.118. The first candidate was 1.789 times bare, so this one bought its quality with more money.

This is a second look at the same tasks. The change was designed after reading how the first candidate failed on them, so the two passing quality checks are weaker evidence than a first look would be. The rule, margins and tasks did not change, and the word list that picks the stronger worker was not tuned on the tasks. It flags 11 of the 16 tasks, against 41 of the 210 routing items, so this mix may overstate how often real work pays for the stronger worker. That is not measured.

Against 4.1 it costs 0.113 times the dollars per draw (0.083 to 0.153) and 0.158 times the tokens (0.108 to 0.230), with more tasks solved. Bare did not drift between recordings (0.976, 0.936 to 1.017). Across the 96 draws there were no inline writes. Against the bare draws in this same recording, dollars per draw are 1.93 times bare (1.59 to 2.35).

Where the money goes:

- The coordinator alone uses 48,115 weighted tokens per draw, more than bare's 40,855 for the whole task. It is 33% of the arm's weighted tokens, workers 42%, reviewers 15%, and 11% is not attributed to an agent.
- The 38 draws where a reviewer ran cost $0.328 each, the 58 where none ran $0.124. Those groups differ in task. Even at $0.124 for every draw and the same 71 solved, the figure would be about 1.42 times bare, so the limit leaves room for almost no review on this mix.
- One draw, N11 draw 1, cost $3.05, which is 15.5% of the arm's dollars. It and two smaller cases come from the defects below. Removing that excess gives about 1.9 times bare, so the defects do not explain the miss.

Where the quality moved, per task against bare: N17 gained 4 solved and H4, N12 and N38 gained 1 each. N10 lost 5, N11 lost 2, and N05 and N37 lost 1 each. The failed safety tests are 30 against bare's 25, down from 61, and the boundary failures seen with the first candidate are gone.

The main thing the transcripts show: reviewers found most of what was missed, and the policy did not act on it. N10 and N11 have 10 unsolved draws between them. In 9 of those, a reviewer named the gap the hidden test checks, such as an existing symlink under the destination or older reset tokens staying valid, and rated it Minor or Nit. Only a Blocker or a confirmed boundary Major re-loops, so the work closed as it was. This count was made after seeing the outcomes, and acting on those findings would also add spend.

Three defects seen while reading, not fixed because the code is frozen for this recording:

- In N11 draw 1, `somi finish` printed only `{"ok":true,"next":"fix"}` with nothing to act on. Workers read that as a failure and stopped, three times, until the draw reached its pass limit.
- A reviewer's finding with evidence over 400 characters rejects the whole report, which happened in 3 draws (N10 draw 1, H4 draw 3, N11 draw 5). In N10 draw 1 the coordinator stopped before closing because the rerun was rejected too.
- In N18 draw 1 the coordinator sent a second worker to amend a finished commit, which tripled that draw's cost.
