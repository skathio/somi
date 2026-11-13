# Quality gate calibration, 2026-11-12

This calibration checks the second version of the gate against the first. The second version adds these rules:
- near-miss and C# copies
- import cycles, forbidden imports, fan-out and unused exports
- option objects
- a growth limit for functions already over a limit
- file size advice
- swallowed errors, leftover debugging, hollow tests and dead names
- no self-declared skips in a benchmark

The scripts are `calibrate.mjs` and `inject.mjs` in this folder. The method is the one in the [2026-11-06 record](calibration-2026-11-06.md).

## Corpus

Fifteen projects. These twelve are JavaScript or TypeScript:
- axios@4ee8d46fc463
- date-fns@a9739fb3e538
- eslint@34a8b1b978f0
- express@43fca52d28a4
- fastify@0b076ca595d1
- immer@784c86bb234e
- zustand@9fed2eb2f3af
- prettier@b57abac13217
- svelte@ff7404cccd5f
- TanStack Query@10123d9884db
- vite@3e1a86e6c87a
- vue core@7c8a0f704f6e

Three are C#:
- AutoMapper@9c31182a3eb9
- Newtonsoft.Json@52fa3aef1f2c
- serilog@43105b350953

## False alarms on known-good commits

The last 30 non-merge commits of each project that touched scored code: 212 commits in all.

| Gate | Commits scored | Commits that fail |
|---|---|---|
| First version | 197 (it crashed on prettier) | 32 (16.2%) |
| Second version | 212 | 30 (14.2%) |

Per project, the second version moved these counts:
- **vue core: 4 to 0.** An anonymous function is now paired with its old version even when the change edited its first line, so a test whose title changed is no longer scored as new.
- **prettier: 0 of 15.** The first version crashed on its deeply nested code. The second records such a file as not analyzed and goes on.
- **date-fns: 3 to 4.**
- **serilog: 0 to 1.**

The two new failures are copies. Copies are now found in C# as well, and near copies are found too.

These rules fail the following number of commits out of 212:

| Rule | Commits |
|---|---|
| cognitive | 13 |
| clone | 10 |
| file-added-cognitive | 9 |
| params | 7 |
| lines | 7 |
| cognitive-grown | 5 |
| file-cognitive | 4 |
| depth | 1 |
| lines-grown | 1 |
| cycle | 1 |

Each new failure was read by hand:
- **cycle (vite).** The change closes a real import loop.
- **clone (C#, 4 commits).** These are exact copies:
  - Newtonsoft: sync and async twins of the same method, and two value providers.
  - serilog: five per-level overloads of `Logger`.
- **clone (vite, 1 commit).** A dependency bump made two 19-line error handlers in one file identical. The copy is real, but the commit did not write it.
- **cognitive-grown and lines-grown (6).** A function already over a limit gained more in one commit than the growth limit allows. The largest gains were 43 and 235 cognitive points.

The growth limit is cognitive 10 and lines 40. Most gains in functions already over a limit were small: 1 to 8 points of cognitive complexity, or a few lines. At the first try of 5 and 20, 18 such gains would have failed. At 10 and 40, 6 fail.

Advice does not fail a commit. These counts are commits out of 212:

| Advice | Commits |
|---|---|
| file-lines | 4 |
| unused-export | 4 |
| cycle-grown | 3 |
| test-without-assertion | 2 |
| pass-through | 2 |
| empty-catch | 1 |
| console | 1 |
| import-fan-out | 1 |
| file-functions | 1 |
| file-added-lines | 1 |
| options | 0 |

`focused-test` and `debugger` never occurred in 212 known-good commits, so both fail a change rather than advise.

## Injected smells

Ten source files per JavaScript or TypeScript project each received one smell at a time. `inject.mjs` does not inject into C# yet.

| Smell | First version | Second version |
|---|---|---|
| pyramid (nesting) | 116/117 | 116/117 |
| long | 116/117 | 116/117 |
| params | 116/117 | 116/117 |
| suppression | 117/117 | 117/117 |
| split (one file's total) | 113/117 | 113/117 |
| clone (exact) | 109/117 | 109/117 |
| near_clone (a line inserted every five) | — | 108/117 |
| options (8-field object) | — | 116/117 |
| generated (a self-declared skip in a benchmark) | — | 116/117 |
| empty_catch | — | 116/117 |
| console | — | 116/117 |
| unused (binding) | — | 116/117 |
| pass_through | — | 116/117 |
| cycle | — | 67/77 |
| unused_export | — | 60/60 |

Why the gate missed what it missed:
- **Most misses are files the parser could not follow** (immer, vite and a date-fns codemod). They are reported as not analyzed, which fails in a benchmark.
- **The cycle misses (10)** add an import into a loop that already existed. That is reported as `cycle-grown` advice, not as a new loop.

The injector now draws the donor of a copy from product files only, using the gate's own test detection. date-fns keeps tests in `test.ts` files next to the code. The first version did not treat those as tests, and the second one does, so they are no longer a place a copy is searched for.

## Near copies of real functions

In five projects, every function of 12 to 60 lines was copied with one line changed in every five:

| Gate | Caught |
|---|---|
| First version | 12/89 |
| Second version | 75/89 |

Both versions catch all 89 exact copies.

## Cost

On vite, the gate over the last 30 commits took 21 s, down from 30 s for the first version. Chaining the seeds of an 80,000-token file takes 2 s.

## Re-run with Python, path aliases and C# accessors

Before release the gate gained Python, imports through the path aliases of a root `tsconfig.json` or `jsconfig.json`, imports read from code only (not from comments or template strings), and C# property accessors measured as functions. The false-alarm run was repeated on the same fifteen projects at the same commits: 212 commits scored and 30 fail, the same per rule as above. The injection run was not repeated for JavaScript and C#, since none of these changes can lower what it catches. Python has [its own record](calibration-2026-11-12-python.md).


## Re-run with copies kept by an edit (2026-11-13)

On a benchmark task built from one template, a change that added the same field to 24 copies of one service was failed for 72 copies: every full window around the added line was new, though the copies were there before. An exact copy now counts only when most of its short seeds are new as well, which a copy the change writes always meets. Near copies were already judged by their seeds.

On the same fifteen projects at the same commits:

| | Before | After |
|---|---|---|
| Known-good commits that fail | 30 of 212 | 29 of 212 |
| Of those, on `clone` | 10 | 6 |

Planted copies were measured with today's injector for both rules, from the same files: 107 of 117 exact copies and 99 of 117 near copies were caught by each, and the missed cases are the same. Most misses are files the gate does not analyze (immer's performance scripts, a date-fns codemod) and six in express. The figures of 109 and 108 above were measured before the injector was changed to copy product code only, so they are not comparable with these.
