# The security reviewer on medium, and somi5 against bare on large work, 2026-11-17

Plain SoMi (`release/next` at af630f6, the boundary rules in the digest) with `"review": { "security_tier": "medium" }`: the
security reviewer runs on the session model instead of the high tier. Session model claude-sonnet-5-5, low tier claude-haiku-5-5,
high tier claude-opus-5-5. Small and medium: 16 and 10 registered tasks, 3 draws each, scored against the bare draws and the
reviewer-on-high draws of `vs-bare-2026-11-17.md`. Large: 8 registered tasks, 2 draws per task and arm, bare run fresh alongside.

Every security review in these draws ran on Sonnet, and no draw spent anything on Opus. A first attempt at a47c23c was stopped and
discarded: the review tool still told the session the reviewer ran on high, and the session asked for Opus itself. af630f6 fixes that.

## Small (48 draws per arm)

| | bare | reviewer on high | reviewer on medium |
|---|---|---|---|
| Hidden tests pass | 36 | **47** | 40 |
| Quality gate | 42 | 48 | 48 |
| Strict successes | 23 | **35** | 30 |
| Dollars per draw | 0.088 | 0.176 | 0.143 |
| Dollars per solved task | 0.117 | 0.180 (1.54x) | 0.172 (1.47x) |
| Opus dollars | 0 | 2.34 | 0 |
| Draws reviewed | 0 | 21 | 21 |
| Second reviews | 0 | 0 | 1 |

## Medium (30 draws per arm)

| | bare | reviewer on high | reviewer on medium |
|---|---|---|---|
| Hidden tests pass | 24 | 24 | 24 |
| Quality gate | 10 | 26 | 27 |
| Strict successes | 9 | 16 | 15 |
| Dollars per draw | 0.205 | 0.395 | 0.328 |
| Dollars per solved task | 0.256 | 0.494 (1.93x) | **0.410 (1.60x)** |
| Opus dollars | 0 | 2.64 | 0 |
| Draws reviewed | 0 | 12 | 11 |
| Second reviews | 0 | 2 | 3 |

## Large (16 draws per arm, reviewer on medium)

| | bare | somi5 |
|---|---|---|
| Hidden tests pass | 9 | 10 |
| Quality gate | 0 | 8 |
| Strict successes | 0 | **6** |
| Dollars per draw | 0.468 | 0.898 |
| Dollars per solved task | 0.832 | 1.436 (1.73x) |
| Draws reviewed | 0 | 16 |
| Second reviews | 0 | 1 |

Both arms solve LG1, LG2, LG4 and LG8 every time and fail LG5, LG6 and LG7 every time; on LG3 somi5 solved 2 of 2, bare 1 of 2.
On LG7 both somi5 draws stopped at the quality gate, and their reviewers found Majors there: an actor field taken without proof,
which lets any caller act as root, and CSV formula injection.

## What it says

- **Medium on the reviewer saves 17–19% per draw** on small and medium work, all of it the Opus spend.
- **On small work it cost solves.** The loss sits on the reviewed tasks: on N10, N11, N37 and H4 the reviewer-on-high draws solved
  12 of 12, the medium ones 7 of 12. On N10 the session's fix for a medium reviewer's Minor broke extraction (1 of 15 tests); on
  H4 the session left an inline-HTML risk the reviewer had graded Minor. On the unreviewed tasks the arms differ by one draw.
- **On medium work it changed nothing measurable:** equal solves, one strict success apart.
- **On large work somi5 is the only arm that passes the strict standard** (6 of 16 against 0): bare fails the quality gate on every
  large draw. Hidden-test solves are close (10 against 9) at 1.7x the cost per solve.
- At 3 and 2 draws per task these are directions, not significant results. The small-segment loss is the largest effect here and
  points one way, but it rests on four tasks.
