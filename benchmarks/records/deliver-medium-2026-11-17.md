# The staged workflow against somi5 and bare, medium, 2026-11-17

`somi5-deliver` (the staged workflow) at af630f6, security reviewer on its default (high), one draw on each of the ten medium
registered tasks. Session model claude-sonnet-5-5, low tier claude-haiku-5-5, high tier claude-opus-5-5. Scored against the medium
bare and somi5 draws of `vs-bare-2026-11-17.md` (3 draws per task; somi5 there is 35d794d, the same digest and reviewer tier).

| | bare | somi5 | deliver |
|---|---|---|---|
| Draws | 30 | 30 | 10 |
| Hidden tests pass | 24 (80%) | 24 (80%) | 8 (80%) |
| Own tests valid | 16 (53%) | 20 (67%) | **10 (100%)** |
| Quality gate | 10 (33%) | 26 (87%) | **10 (100%)** |
| Strict successes | 9 (30%) | 16 (53%) | **8 (80%)** |
| Dollars per draw | 0.205 | 0.395 | 1.809 |
| Dollars per solved task | 0.256 | 0.494 | 2.261 |
| Dollars per strict success | 0.683 | 0.741 | 2.261 |
| Opus dollars per draw | 0 | 0.088 | 0.903 |
| Draws using the high tier | 0 | 12 | 10 |

## What it says

- **Deliver solves the same tasks.** All three arms solve eight of the ten and fail the same two (MD5, MD6) on every draw.
- **Every deliver solve meets the strict standard**: valid tests and a clean gate on all ten draws. somi5 meets it on two thirds of
  its solves, bare on three in eight.
- **It costs 4.6x somi5 and 8.8x bare per draw,** and 3.1x somi5 per strict success. Half of its spend is the high tier.
- One draw per task: a direction, not a significant result. Small and large are not yet measured for deliver at this pin.
