# Quality gate calibration, 2026-11-06

This calibration measures what the gate makes of code that people already reviewed and accepted, and whether it still catches what it is for. The scripts are `calibrate.mjs` and `inject.mjs` in this folder.

## Corpus

Twelve JavaScript and TypeScript projects, cloned at these commits:
- axios@a81d62a22e4b
- date-fns@a9739fb3e538
- eslint@bbede5e5f2af
- express@43fca52d28a4
- fastify@6c14896e67dd
- immer@75a290e44ba1
- zustand@9fed2eb2f3af
- prettier@b09dd90022c8
- svelte@7775f73b7cbe
- TanStack Query@c34ce05d6140
- vite@a579e352a66f
- vue core@8b479a894458

That is 31,912 product functions, 72,948 test functions and 527 components.

## How code at HEAD measures, per function

These are the medians across the twelve projects of each project's 95th and 99th percentile.

| Kind | Cognitive | Nesting | Lines | Parameters |
|---|---|---|---|---|
| Function | 11 / 29 | 2 / 4 | 33 / 83 | 3 / 4 |
| Test | 1 / 3 | 1 / 1 | 24 / 45 | 2 / 3 |
| Component | 1 / 1 | 1 / 1 | 59 / 89 | 1 / 1 |

2.8% of product functions exceed cognitive 15, and 1.6% exceed 60 lines.

Line-weighted percentiles (Alves, Ypma and Visser) were also computed. They are not used, because a single generated function of thousands of lines sets them. Fastify's validator, for example, scores 4,676.

## False alarms on known-good commits

Each project's last 30 non-merge commits that touched scored code were run through the gate: 158 to 168 commits, depending on the round.

| Round | What changed | Commits that fail |
|---|---|---|
| 1 | First version | 75% |
| 2 | A function's lines exclude nested functions. Copies are looked for only inside functions. A file fails only when a change takes it over its limit. A function already over a limit only warns when it gets worse, as SonarQube treats an existing issue. Parse errors fail only where they touch the change. A suppression with a reason passes. | 42% |
| 3 | Test limits are cognitive 8, nesting 3 and 60 lines. Copies are looked for in product code only. Docs, examples, demos and playgrounds are skipped. Code the grammar cannot follow warns in a project and fails in a benchmark. | 25.3% |

The 40 commits that still failed after round 3 were then rerun under variant limits:

| Variant | Commits that fail |
|---|---|
| Round 3 limits | 25.3% |
| Copies at 75 tokens | 20.9% |
| Copies at 100 tokens | 17.1% |
| Tests up to 150 lines | 22.8% |
| Cognitive 20 | 22.8% |
| Copies at 100 tokens, tests up to 150 lines (**chosen**) | **14.6%** |
| Those two, plus cognitive 20 | 11.4% |

The 5% target from the research was not reached. Getting close would take limits looser than any common tool's defaults. Read individually, the remaining failures are mostly findings rather than noise:
- **Copies:** date-fns writes every small function in the same shape on purpose.
- **Complexity:** new functions score 16 to 19, just over SonarQube's 15.
- **Length:** tests run to 200 lines in Vue's style.

The default stays at the common limit, and a user who wants it looser can set it in their own config.

## Catching injected smells

One known smell at a time was added to 10 product files in each project, and the gate run on that change.

| Smell | Caught |
|---|---|
| Nesting pyramid | 97 of 99 |
| Function over 60 lines | 97 of 99 |
| Six parameters | 97 of 99 |
| Suppression without a reason | 98 of 99 |
| One function split into five that add 30 to a file | 97 of 99 |
| Copy of a 12–60 line function from another file | about 90 of 99 |

That is about 3% missed overall, against a target of 10%. At 100 tokens the gate still caught every injected copy in express, fastify and eslint.

The misses fall into two groups:
- **Copies:** a few were in files with performance scripts, where only the suppression was caught.
- **One immer type file:** the grammar cannot fully follow it, so the gate only warns there in project mode.

A first run aborted inside the parser on seven projects. Parse trees live in WebAssembly memory, which the garbage collector does not free, and the gate was not deleting them. It does now.

## Chosen defaults

| Kind | Cognitive | Nesting | Lines | Parameters |
|---|---|---|---|---|
| Function | 15 | 4 | 60 | 4 |
| Component | 15 | 4 | 150 | 4 |
| Test | 8 | 3 | 150 | 4 |

The other limits are:
- **File total:** 100. A change may not take a file over it.
- **Per change:** at most 25 added to one file.
- **Copies:** 100 tokens.
- **Stylesheets:** nesting 3, chained selectors 3, no ID selectors, no `!important`.

## Known gaps

- **Short copies:** a copy shorter than about 100 tokens, roughly ten lines, is not caught. A three-line access check pasted into each new function is that size. In `/somi:deliver` the rules stage and the access-control review cover that case. Set `quality.clones.tokens` to 50 to catch it, at about 25% false alarms on known-good commits.
- **Missing generated markers:** a generated file without a marker is scored like hand-written code, as fastify's validator was.
- **Grammar lag:** the vendored grammars do not parse all new TypeScript syntax. A newer grammar build would narrow that.
