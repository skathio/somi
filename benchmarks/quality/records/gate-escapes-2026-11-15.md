# Does the gate stop poor code? An independent review of what it passed (2026-11-15)

The gate's catch rate, 97% of planted problems, only counts problems of the kinds it already looks for. This study asks the other
question: of the problems a careful reviewer would block a merge on, how many does the gate catch?

## Method

- **Samples.** Six medium benchmark tasks: two features, each in JavaScript, TypeScript, Python or C#. One bare draw and one plain
  SoMi draw each, on Sonnet, so 12 changes of about 20 to 120 lines over 2 to 8 files. Cost: $4.46.
- **The gate.** Each change was rebuilt on the task's starting code and scored as a benchmark scores it: strict limits, no suppressions.
- **The reviewer.** An Opus agent per change, which never saw the gate's output. It listed every issue it would ask the author to fix
  before merge, on maintainability alone, with a category and a severity: major, which blocks the merge, or minor. It also graded each
  change from 1, rework, to 5, merge as is.

## Results

| | bare | plain SoMi |
|---|---|---|
| Passed the gate | 0 of 6 | 6 of 6 |
| Reviewer's grade, mean | 2.3 | 3.0 |
| Changes with a major issue | 4 of 6 | 3 of 6 |
| Major issues | 9 | 5 |

- **The gate caught 1 of the 14 major issues:** a block of restore code copied across services.
- **It passed three changes the reviewer would block.** All three were plain SoMi changes, so a SoMi change that passes the gate is
  not yet a change a reviewer would merge.
- **What the gate failed bare changes on was mostly not what the reviewer raised.** Four of six bare changes failed on a fifth or
  sixth parameter, which the reviewer never mentioned. The copies the gate failed (hand-written lookup tables, one entry per kind) the
  reviewer did raise, as minor.
- **Its warnings were noise here:** 16 unused-export warnings, none of which the reviewer raised.

The 14 major issues, by kind:

| Kind | Count | Could a rule catch it? |
|---|---|---|
| A new operation writes past the layer that owns the data, skipping its rules and its events | 7 | No: a design judgement. It is the review's job. |
| A type cast that switches the checker off (`as never`, `as unknown as`) | 2 | Yes, mechanically, in TypeScript |
| Silent fallback: an unknown case dropped, or intent inferred from an incidental field | 2 | Partly: a catch-all branch that returns its input unchanged |
| Restored data not checked against the rules that hold on create | 1 | No |
| Copied code across files | 1 | Yes, and the gate caught it |
| A change that announces nothing where every other change does | 1 | No |

Minor issues the gate could catch mechanically, and does not: an unused import in Python, non-null assertions and `any` in
TypeScript tests, a copy of about 15 lines repeated in three files (below the gate's 100-token copy limit), and a magic number beside a
named one.

## What it says

- **The gate is a floor for size and copies, not a quality bar.** It cannot judge design, and design is where most blocking issues
  were. That job belongs to the review, and SoMi's review missed it. On the three plain SoMi changes with a major issue, no review
  ran: no signal fired on the diff, and on two of them the session never asked SoMi's router either. On the other three, only the
  security reviewer ran, because a security signal fired. A change that fires no signal gets no review of its design.
- **Two mechanical gaps are worth closing:** casts that switch off type checking in TypeScript, and unused imports in Python.
- **The parameter limit fails changes a reviewer would accept,** and is worth calibrating again on reviewed code.

## Limits

12 changes, one reviewer each, all from one model. The reviewer is a model too, and its issues were not checked by hand. Read the
numbers as directions, not rates.
