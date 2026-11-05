# Benchmark record: candidate

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 112 of 112. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare-check | 16 | 12 | 0.75 | 0.75 | 53761 | 0.116 | 0.6 | {"finished":16} |
| somi5 | 96 | 78 | 0.88 | 0.50 | 337666 | 0.188 | 2.8 | {"finished":93,"stopped-at-gate:open-blocking":3} |

## Against bare-check

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 5.09 (3.94 to 6.57) | 1.25 (0.91 to 1.72) | 4.22 (3.42 to 5.22) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare-check | {} | {"none":16} | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0869} | {"main":40320} | 1.00 |
| somi5 | {"debug":13,"build":68,"refactor":4,"perf":1} | {"tool":96} | 0.33 | {"open-blocking":3} | 0 | 343 | {"Minor":75,"Nit":45,"Major":10} | {"claude-haiku-5-5":0.0223,"claude-sonnet-5-5":0.1305} | {"somi:somi-worker-medium":33613,"unknown":42170,"main":125601,"somi:somi-reviewer":56115,"somi:somi-security-reviewer":12855} | 0.69 |

## Reading

This is exploratory, and a fourth look at the same 16 tasks, so it is not a release pass. It records the advice design on 1085bce: the agent holds the conversation on Haiku, `somi_route` and `somi_review` advise, and work goes to a Sonnet worker only when it needs one. Each draw is still one prompt and an "Approved", so it says nothing about the follow-ups that the design exists for. Bare did not drift (0.98, 0.94 to 1.03).

| Arm | Solved of 96 | Dollars per solved | Against bare | Solved rate against bare | Hidden tests against bare | Minutes per solved |
|---|---|---|---|---|---|---|
| Bare | 73 | $0.118 | | | | 0.7 |
| Second candidate, Sonnet coordinator | 71 | $0.277 | 2.35x | -2.1 (-18.3 to +14.1) | -0.4 (-1.9 to +1.1) | 2.1 |
| Cheap `/somi` on the step engine | 77 | $0.114 | 0.97x | +4.2 (-11.2 to +19.5) | +0.0 (-1.5 to +1.5) | 2.1 |
| **Advice design** | 78 | $0.188 | **1.60x** | +5.2 (-16.7 to +27.1) | **-5.7 (-15.4 to +4.0)** | 2.8 |

`decide` says it does not ship: dollars are over 1.5x, and the hidden-test bound is below its -5 point margin. Against 4.1 it costs 0.074x the dollars per draw (0.052 to 0.104).

Where the money goes:

- Draws average 17.6 turns, against 8.7 for the cheap `/somi` arm. The main thread's weighted tokens per draw doubled, to 125,600, and the plain reviewer's quadrupled, to 56,100. In the N10 transcript read, the agent acts on reviewers' non-blocking comments and runs the reviewers again, against the advice it was given, and it adds acceptance criteria and test instructions to the reviewers' brief.
- The 36 draws with a worker and a review cost $0.253 each, 62% of the spend. The 12 draws Haiku did alone with no review cost $0.012 each and solved 10.
- Routing now goes through the agent's own wording. On N01, N02, N18 and N22 it chose `debug` or `refactor`, which run at the medium tier, where the step engine's arm chose `build`. N01 costs $0.144 a draw against $0.014 before, with the same 6 of 6 solved.
- The words that mark sensitive work can be lost in the agent's rewording. On N10 and N09 it did untrusted-input or retry work itself in some draws.

Quality per task, against pooled bare: H4 5 of 6 against 0 of 17, and N17 5 of 6 against 5 of 17. N05 solved 2 of 6, two of its misses being draws that ended with a blocking finding still open, which the scorer counts as unsolved because `somi pr` would refuse them. N10 solved 2 of 6, N11 3 of 6 and N37 3 of 6, which is where the hidden-test share falls.

The longer tasks went better, in a few draws each. On the three large tasks it solved 6 of 6, including L3 at $0.41 against $1.39 before. With the context squeezed to force compaction, the plain arm solved 6 of 6 against 1 of 2 to 2 of 3 in earlier rounds, and the milestone arm 3 of 6.

Reading this fairly: the step engine was cheaper on one-shot tasks because it kept a cheap model from wandering, and that is the same control that made it hard to use. The advice design gives that up. Whether its cost can come down without the control coming back is the next question.
