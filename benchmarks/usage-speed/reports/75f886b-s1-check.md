# S1 check: 75f886b (`close` writes the progress lines)

A transcript check, not a rule verdict. The question was fixed before any row: does the S1 (`/code-loop`)
main-thread median reach the pre-registered bar of [`loop-step-mcp-prereg.md`](./loop-step-mcp-prereg.md),
**13 turns or fewer with weighted tokens below 164k**, once `close` writes the two progress.md lines that every S1
draw of [`e376e98-vs-6cced12.md`](./e376e98-vs-6cced12.md) wrote by hand? The compare tool needs S1–S3, so these
rows are not a candidate baseline and the cost verdict of record stays the e376e98 report's (inconclusive).

- Candidate: `75f886bab4707c65501123b4eae4609a4766d187`, plugin 4.1.0, exported with tests and benchmarks excluded.
- 8 one-repeat S1 chunks (seeds 1–8), 2026-10-31, model alias `haiku`, tier `low`, every agent pinned, the
  baseline's caps (`--budget-total 3 --budget-somi 2 --budget-bare 1`), same host as 6cced12. Every draw `scored`,
  no halt. Spend: $0.42 over 0.43 h.

**Result: the bar is met.** S1 main-thread median 13 turns and 99k weighted tokens (6cced12: 24.5 turns, 164k;
e376e98: 16 turns, 117k).

## Dollars and time against bare (medians per draw, 8 draws per arm)

| Candidate | SoMi | Bare | SoMi / bare |
|---|---|---|---|
| 75f886b | $0.033, 149 s | $0.0047, 22 s | 7.1× cost, 6.8× time |
| e376e98 | $0.036, 132 s | $0.0044, 21 s | 8.1×, 6.3× |
| 6cced12 | $0.046, 180 s | $0.0049, 21 s | 9.4×, 8.7× |

## Per agent (transcripts)

Weighted token cost (cache reads 0.1, cache writes 1.25, uncached input 1), medians per SoMi draw, same script as
the e376e98 report:

| Candidate | Main thread | Coder | Reviewer |
|---|---|---|---|
| 75f886b | 99k, 13 turns | 64k, 8.5 turns | 45k, 5 turns |
| e376e98 | 117k, 16 turns | 72k, 10.5 turns | 57k, 7.5 turns |

Main-thread turns per draw: 29, 15, 13, 13, 13, 13, 12, 13.

- After `close` no draw edited progress.md: every `close` returned `unwritten` empty (one draw read the file once).
- Seed 1 needed three passes (29 turns, the costliest draw); the other seven were one-pass loops.
- Seed 7 did not close its loop: the reviewer returned `approve-with-comments` with a Major finding (a hard-coded
  secret that predates the task), `after-review` refused that verdict as inconsistent (exit 64), and the main thread
  stopped and asked, as the flow says to on a refusal. Its 12 turns end early; without it the median of the other
  seven is still 13.
- No loop CLI call from the main thread in any draw.

## Limits

- Eight draws of one scenario; S1 noise at this size is wide, and pass counts (one draw in eight here, three in
  eight on e376e98) move the median. The two runs are not a paired comparison.
- Not a rule verdict and not a cost claim; the low tier only.
