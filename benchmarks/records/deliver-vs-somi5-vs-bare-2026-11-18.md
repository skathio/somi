# The staged workflow, somi5 and bare across all three segments, 2026-11-18

`somi5-deliver` (the staged workflow) at af630f6 with the security reviewer on high, against the bare and somi5 draws of
`vs-bare-2026-11-17.md` (small and medium; somi5 there is 35d794d, the same digest and reviewer tier) and
`security-tier-2026-11-17.md` (large; somi5 there ran its security reviewer on medium). Session model claude-sonnet-5-5, low tier
claude-haiku-5-5, high tier claude-opus-5-5.

Draws per task: small 3/3/1–2 (bare/somi5/deliver; deliver's run stopped at its $30 cap after every task's first draw and nine
second ones), medium 3/3/3, large 2/2/2. A full-pass draw (strict success) passes the hidden tests, kills at least 60% of the
reference's mutants with its own tests, and passes the quality gate.

## Small

Matched draws: for each task, only as many bare and somi5 draws as deliver has (25 per arm).

| | bare | somi5 | deliver |
|---|---|---|---|
| Hidden tests pass | 19 | **24** | 20 |
| Own tests valid | 18 | 18 | 20 |
| Quality gate | 21 | 25 | 25 |
| Strict successes | 14 | **18** | 16 |
| Dollars per draw | 0.085 | 0.162 | 1.085 |
| Dollars per strict success | 0.15 | 0.23 | 1.70 |

## Medium (30 draws per arm)

| | bare | somi5 | deliver |
|---|---|---|---|
| Hidden tests pass | 24 | 24 | **27** |
| Own tests valid | 16 | 20 | **30** |
| Quality gate | 10 | 26 | **29** |
| Strict successes | 9 | 16 | **26** |
| Dollars per draw | 0.205 | 0.395 | 1.806 |
| Dollars per strict success | 0.68 | 0.74 | 2.08 |

## Large (16 draws per arm)

| | bare | somi5 | deliver |
|---|---|---|---|
| Hidden tests pass | 9 | 10 | **12** |
| Own tests valid | 14 | 13 | 14 |
| Quality gate | 0 | 8 | **16** |
| Strict successes | 0 | 6 | **10** |
| Dollars per draw | 0.468 | 0.898 | 4.456 |
| Dollars per strict success | n/a | 2.39 | 7.13 |

## What it says

- **Small: deliver does not pay.** It solves fewer than somi5 (20 against 24 on matched draws) at 6.7x the cost per draw. Four of
  its five misses fail one safety case each (N37, N38, N10, N18); the fifth, on N10, broke extraction outright (1 of 15).
- **Medium: deliver is the strongest arm on quality.** It solves the most (27), and 26 of 30 draws pass the strict standard against
  16 for somi5 and 9 for bare. Every draw's own tests were valid. A strict success costs 2.8x somi5's.
- **Large: deliver is the only arm to solve LG5 and LG6** (once each), and passes the gate on all 16 draws. 10 strict successes
  against 6 and 0, at 3.0x somi5's cost per strict success. somi5's large draws ran the reviewer on medium, which may have cost it.
- About half of deliver's spend is the high tier on every segment.
- At 1–3 draws per task these are directions, not significant results. The medium strict-success gap (26 against 16 of 30) is the
  largest effect here.
