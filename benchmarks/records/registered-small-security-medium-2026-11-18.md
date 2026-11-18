# The registered small recording for 5.2, security reviewer on medium, 2026-11-18: ships

somi5 at the 5.2.0 candidate (`release/next` at 7aa26aa) against bare, on the 16 registered small tasks at 6 draws per task and arm,
under the bench's `prereg.json` version 6 (rule hash 3ec4b191…). Session model claude-sonnet-5-5, low tier claude-haiku-5-5, high tier
claude-opus-5-5, and **the security reviewer on the medium tier** (`review.security_tier: medium` in each draw's own config). Every
phase was recorded on fresh draws: A/A (bare against bare, 96 draws), baseline (bare, 96 draws) and candidate (somi5, 96 draws, with a
16-draw bare check arm).

The same build with the security reviewer on its default, high, did not ship: 1.85x bare's cost per solved task
([record](registered-small-2026-11-18.md)). Version 6 changed only the reviewer's tier, and was registered after that result and after
an unregistered look at the 7 boundary tasks (20 of 21 solved at $0.216 per draw, against 41 of 42 at $0.338 on high).

## The verdict

`decide` says **ships**.

| Check | Reading | Rule | Met |
|---|---|---|---|
| A/A, bare against bare | +0.02, interval −0.13 to +0.17 | contains zero | yes |
| Solved-rate difference, somi5 − bare | +0.17, interval +0.03 to +0.30 | lower bound at or above −0.2 | yes |
| Test-share difference | −0.006, interval −0.047 to +0.035 | lower bound at or above −0.05 | yes, narrowly |
| Dollars per solved task | **1.36x bare** | at most 1.5x | yes |

## The arms

| | bare (baseline) | somi5, security reviewer on medium |
|---|---|---|
| Hidden tests pass | 73 of 96 | 89 of 96 |
| Own tests valid | 71 | 64 |
| Quality gate | 85 | 96 |
| Strict successes | 54 | 62 |
| Dollars per draw | 0.088 | 0.146 |
| Dollars per solved task | 0.116 | 0.157 |

## What it says, and what it does not

- The claim is SoMi with `review.security_tier: medium`. SoMi's shipped default stays `high`, which this build failed on cost.
  On the earlier tier recording medium also lost solves on the reviewed tasks (40 of 48 against 47); here it did not.
- The solved gain's interval clears zero. The strict gain is smaller (62 against 54), and somi5's own tests were valid less often
  than bare's (64 against 71); the test-share check passed by 0.003.
- Medium and large are recorded in the full phase under their own guards, and are not read here.
