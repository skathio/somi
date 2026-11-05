# Benchmark record: light

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 208 of 208. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare-check | 16 | 13 | 0.81 | 0.81 | 51665 | 0.110 | 0.7 | {"finished":16} |
| somi5 | 96 | 75 | 0.69 | 0.44 | 236819 | 0.131 | 2.3 | {"finished":96} |
| somi5-pin | 96 | 77 | 0.75 | 0.56 | 203996 | 0.114 | 2.1 | {"finished":96} |

## Against bare-check

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| somi5 | 3.40 (2.63 to 4.40) | 0.81 (0.58 to 1.13) | 2.83 (2.27 to 3.52) |
| somi5-pin | 3.29 (2.61 to 4.15) | 0.78 (0.58 to 1.07) | 2.76 (2.28 to 3.35) |

## Protocol and spend

| Arm | Routed to | Tool or CLI | Closed | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare-check | {} | {"none":16} | 0 | 0.00 | {} | 0 | 2 | {} | {"claude-sonnet-5-5":0.0892} | {"main":41978} | 1.00 |
| somi5 | {"build":93,"debug":3} | {"tool":96} | 94 | 0.54 | {} | 0 | 0 | {"Major":17,"Minor":105,"Nit":72} | {"claude-haiku-5-5":0.015,"claude-sonnet-5-5":0.0871} | {"somi:somi-worker":68310,"unknown":15920,"main":59138,"somi:somi-security-reviewer":7239,"somi:somi-reviewer":14735} | 0.52 |
| somi5-pin | {"build":95,"debug":1} | {"tool":96} | 94 | 0.43 | {} | 0 | 0 | {"Minor":91,"Nit":53,"Major":15,"Blocker":1} | {"claude-haiku-5-5":0.0133,"claude-sonnet-5-5":0.0781} | {"somi:somi-worker":60373,"unknown":13927,"main":56442,"somi:somi-reviewer":13387,"somi:somi-security-reviewer":6788} | 0.56 |

## Reading

This is exploratory. It is a third look at the same 16 tasks, and tested fixes were designed after reading N10 and N11 on those tasks. The pin is a bench patch, not shipped code, and it needs the user to type `/somi`. So `decide` passing here is not a release pass. Both arms are Claude only.

`somi5` is the cheap `/somi` command with tested fixes. `somi5-pin` is the same with tested fixes off. Both are compared with the bare arm of the baseline recording, as in the release rule. Same-run bare did not drift (0.998, 0.94 to 1.06). Bare is pooled over 256 draws where a per-task figure needs more than 6 draws.

| Check | Limit | `somi5` | `somi5-pin` |
|---|---|---|---|
| Solved of 96 (bare 73) | | 75 | 77 |
| Dollars per solved (bare $0.118) | | $0.131 | $0.114 |
| Dollars against bare | at most 1.5x | 1.11x | 0.97x |
| Solved rate against bare, 95% interval | lower at least -20 points | +2.1 (-9.6 to +13.7) | +4.2 (-11.2 to +19.5) |
| Hidden tests passed against bare, 95% interval | lower at least -5 points | -0.2 (-1.2 to +0.9) | +0.0 (-1.5 to +1.5) |
| A/A interval contains zero | yes | yes | yes |
| Wall time per draw against bare, 90% interval | not in the rule | 2.97x (2.43 to 3.63) | 2.91x (2.42 to 3.49) |
| Weighted tokens per solved against bare | not in the rule | 4.3x | 3.7x |
| Dollars against 4.1, 90% interval | not in the rule | 0.048x (0.034 to 0.068) | 0.047x (0.034 to 0.065) |

The result holds when the follow-ups described below are counted against SoMi. With all 11 follow-up draws scored unsolved, `somi5` is 71 solved at 1.17x and `somi5-pin` is 72 at 1.03x, and both still pass every check.

## Which parts show a gain

Both arms together, 192 draws, against pooled bare:

| Path | Tasks | Draws | Solved | Dollars per draw | Bare on the same tasks |
|---|---|---|---|---|---|
| Haiku worker, no review | mostly N01, N17, N18 | 47 | 40 | $0.030 | $0.077 |
| Sonnet worker, no review | mostly H1, N02, N04, N12, N13, N37, N38 | 73 | 62 | $0.075 | $0.087 |
| Reviewed | mostly H4, N05, N09, N10, N11, N22 | 72 | 50 | $0.162 | $0.096 |

- **The cheap coordinator shows a large gain, against earlier SoMi.** Dollars per solved fell from $0.277 to $0.114 with no measured quality loss. It is what moved SoMi from 2.35x to about 1x. Haiku served the main thread in every draw until a follow-up.
- **Routing small work to Haiku shows a gain against this bare arm.** N01 and N18 cost about a fifth of bare and stayed at 24 of 24 solved. N17 cost 0.4x bare and solved 7 of 12 against 5 of 16. There is no bare-on-Haiku arm, so this compares against a user who stays on Sonnet, not one who picks Haiku themselves.
- **Review shows no gain on the hidden tests, for the third time.** It is 63% of SoMi's dollars. The six mostly reviewed tasks solved 49 of 72 (68%) against bare's 73 of 96 (76%). The other ten solved 103 of 120 (86%) against bare's 133 of 160 (83%). Those groups differ by design, because review goes to sensitive tasks, and the tests do not reward everything reviewers find. H4 is the exception: 5 of 12 against 0 of 16 for bare, though some of those solves came through follow-ups.
- **Tested fixes show no overall gain.** Against `somi5-pin` the solved rate is -2.1 points (-13.7 to +9.6), at 1.03x the dollars per draw (0.93 to 1.14). They fired in 19 of 96 draws and 15 of those were solved. N10 went from 1 of 6 to 4 of 6 and N11 from 2 of 6 to 4 of 6, the two tasks they were designed from. Failed safety tests were 19 against 24. But on tasks where they never fired, and so could not have mattered, `somi5` still lost 7 solves to `somi5-pin`, which is as large as the 5 gained on tasks where they did fire.
- **Time is a measured loss.** SoMi takes about three times as long as bare per draw.

## Where SoMi still loses to bare

N10 solved 5 of 12 against bare's 14 of 16, and N11 solved 6 of 12 against 12 of 16. Nearly all those draws used a Sonnet worker, the same model as bare, and all were reviewed. The failures are the unprompted safety tests. On N10 there were 11 such failures in 12 draws against bare's 3 in 16, and on N11, 6 in 12 against 5 in 16. The worker's brief says to "make the smallest change that meets the request" and to "touch nothing the request does not need", and bare gets no such instruction. That wording is a likely cause and has not been tested.

## Follow-ups and unreviewed commits

- 11 of 192 draws stopped with a question or open items and took the bench's "Approved" reply, against 1 of 96 for bare. That reply starts a new turn, which runs on Sonnet. These 11 draws cost $3.94, which is 21% of the spend, at $0.36 each against $0.08 for the rest.
- **In 6 of the 11, Sonnet wrote more code on the main thread and committed it with no SoMi review:** N09 draw 1, N17 draw 5, H4 draw 4, N17 draw 2, N11 draw 4, N22 draw 6, the last three in `somi5-pin`. All six were solved, and I did not measure how many would have been solved without the extra code. This breaks the promise that SoMi's reviews cover what it commits. A real user's "yes, fix it" would do the same.
- In 2 others the follow-up came back through SoMi and was re-reviewed. In 2 it only finished the commit, and in 1 it changed nothing.

Defects behind some of these, to fix before any further recording:

- The engine refuses a review whose file path is absolute (10 draws) or whose claim is over 400 characters (3 draws). Evidence over the limit is already cut, and these are not. Haiku sometimes gives up here instead of retrying (N05 draw 4, N11 draw 2, both `somi5-pin`).
- Haiku sometimes declines the commit step: "you didn't ask for a commit" (H4 draw 1, `somi5-pin`) and a complaint about the message (H4 draw 2, `somi5`).
- Haiku reports open review items at the end as questions, which invites the follow-up above.

## What this does not show

- Only `/somi` typed by the user gets the pin. A prompt with no command stays on the session model, so it should cost about what the second candidate cost. That was not measured here.
- Copilot was not tested, and I found no equivalent pin there.
- Routing went to `build` in 188 of 192 draws, so these tasks do not test routing.
- Sessions on a stronger model than Sonnet would save more from the pin, but the bench never runs on the top model.
- The run cost $20.00 and took 5 hours 45 minutes, under my estimate of $31 and about the 6 hours I expected. An earlier attempt stopped after 9 draws and $1.25 because Haiku started workers in the background, which ended the pinned turn. That was fixed in a4312b5 and those draws are not counted.
