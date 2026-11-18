# The registered small recording for 5.2, 2026-11-18: does not ship

somi5 at the 5.2.0 candidate (`release/next` at 7aa26aa) against bare, on the 16 registered small tasks at 6 draws per task and arm,
under the rule bound in the bench's `prereg.json` version 5 (rule hash 0cf5a626…). Session model claude-sonnet-5-5, low tier
claude-haiku-5-5, high tier claude-opus-5-5, the security reviewer on high. Phases: A/A (bare against bare, 96 draws), baseline (bare,
96 draws) and candidate (somi5, 96 draws, with a 16-draw bare check arm). Two phases stopped a few draws short at their budget cap and
were resumed on the same plan, so every phase has all its draws.

## The verdict

`decide` says **does not ship**, for one reason: dollars per solved task are over the allowed ratio to bare.

| Check | Reading | Rule | Met |
|---|---|---|---|
| A/A, bare against bare | +0.10, interval −0.06 to +0.27 | contains zero | yes |
| Solved-rate difference, somi5 − bare | +0.16, interval +0.006 to +0.31 | lower bound at or above −0.2 | yes |
| Test-share difference | +0.011, interval +0.001 to +0.021 | lower bound at or above −0.05 | yes |
| Dollars per solved task | **1.85x bare** | at most 1.5x | **no** |

## The arms

| | bare (baseline) | somi5 |
|---|---|---|
| Hidden tests pass | 75 of 96 | 90 of 96 |
| Quality gate | 82 | 95 |
| Strict successes | 49 | 69 |
| Dollars per draw | 0.087 | 0.194 |
| Dollars per solved task | 0.112 | 0.207 |

somi5 solved more and passed the strict standard more often, and the solved gain is the first on this set whose interval clears zero.
It did not do so cheaply enough.

## Where the extra cost is

The security reviewer accounts for nearly all of it. It ran on every draw of the 7 tasks whose change touches a trust boundary
(42 of 96 draws, 52 reviews), and on no other draw.

| somi5 draws | Draws | Session model per draw | High tier (reviewer) per draw | Total per draw | Against bare |
|---|---|---|---|---|---|
| Not reviewed | 54 | 0.097 | 0 | 0.097 | about 1.1x |
| Reviewed | 42 | 0.194 | 0.144 | 0.338 | about 3.9x |

On the reviewed tasks somi5 solved 41 of 42 draws against bare's 30, so the review buys solves where it runs. On the others it
solved 49 of 54 against bare's 45. The digest and the end-of-turn gate cost about a tenth over bare; a reviewed draw costs about
four times, half of it in the reviewer and half in the session's own extra work around the review.

## What follows

5.2 is held. The next step is to find what in the review round can cost less without lowering what fires a review or who reviews,
then a new pre-registration and a fresh recording. The medium and large segments are recorded in the full phase under their own
guards and are not read here.
