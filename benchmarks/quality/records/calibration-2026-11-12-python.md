# Quality gate calibration for Python, 2026-11-12

This calibration measures what the gate makes of Python that people already reviewed and accepted, and whether it still catches what it is for. The scripts are `calibrate.mjs` and `inject.mjs` in this folder, both run with `--lang python`. The limits are the ones the first calibration chose for JavaScript and TypeScript ([record](calibration-2026-11-06.md)). The question here is whether Python can be held to them.

## Corpus

Eight Python projects, cloned at these commits:
- requests@3c7baaa05ab4
- flask@49943b5a9441
- click@8abb77a8432e
- httpx@b5addb64f016
- rich@3a109ccdffe5
- attrs@9d9f94a043de
- pytest@fc9a7ef678f6
- black@b4f1fcae4882

That is 1,207 files with 6,883 product functions and 11,247 test functions. Three of black's files were too large to parse and were left out.

## How code at HEAD measures, per function

These are the medians across the eight projects of each project's 95th and 99th percentile, and the share of all functions over the default limit.

| Kind | Cognitive | Nesting | Lines | Parameters |
|---|---|---|---|---|
| Function | 12 / 32 | 3 / 4 | 34 / 68.5 | 3 / 4 |
| Test | 1 / 4 | 1 / 2 | 19 / 37 | not counted |

| Kind | Over cognitive | Over nesting | Over lines | Over parameters |
|---|---|---|---|---|
| Function | 4.0% over 15 | 0.8% over 4 | 1.6% over 60 | 1.2% over 4 |
| Test | 0.2% over 8 | none over 3 | none over 150 | not counted |

These are close to the JavaScript corpus, where 2.8% of product functions exceed cognitive 15 and 1.6% exceed 60 lines. So Python keeps the same limits.

Three readings are Python's own:
- **Branches:** every `elif` and the `else` add one, an `except` adds one and nests what it holds, `match` counts once like `switch`, and a run of `and` or `or` counts once.
- **Parameters:** a method's `self` or `cls` is not one. The parameters a caller may leave out (a default, `*args`, `**kwargs`) count together as one, as an options object does in JavaScript. In a test file they are not counted at all, because a pytest test names the fixtures it wants as parameters and nobody passes them.
- **Lines:** a docstring is not a line of code.

## False alarms on known-good commits

Each project's last 40 non-merge commits were run through the gate, and 159 of them touched scored Python.

| Round | What changed | Commits that fail |
|---|---|---|
| 1 | Every parameter counted. Every new `# noqa` and `# type: ignore` a violation | 30 of 159 (18.9%) |
| 2 | Optional parameters count as one. A suppression that names its rule passes, as an ESLint one with a reason does | 18 of 159 (11.3%) |
| 3 | Parameters are not counted in test files | **13 of 159 (8.2%)** |

In round 1, 14 commits failed on a suppression alone. Nearly all were coded: `# type: ignore[arg-type]` or `# noqa: E501`. A coded suppression hides one named finding on one line, which is the decision a reason records. A bare `# noqa` or `# type: ignore` hides everything on the line and still fails. In a benchmark every new suppression fails, coded or not.

In round 2, five of the six commits that failed on parameters were tests: four in click, whose tests take five or six fixtures, and one in black's test data.

By project, round 3: requests 0 of 10, flask 1 of 21, click 3 of 23, httpx 2 of 16, rich 1 of 21, attrs 0 of 14, pytest 2 of 19, black 4 of 35.

What the 13 failing commits fail on (a commit can fail on more than one rule):

| Rule | Commits | Where |
|---|---|---|
| Cognitive complexity | 7 | Five product functions scoring 16 to 19, in click, httpx, pytest and black. Two click commits on one test that scores 9 against the test limit of 8 |
| A copy of 100 tokens or more | 4 | httpx's `get`, `post` and `put`, which repeat one signature on purpose, in two commits. One commit each in flask and rich |
| More than 25 added to one file in one change | 2 | black, adding 30 and 43 |
| More than four required parameters | 1 | pytest, a function with five |
| A function over 60 lines | 1 | the same pytest commit, 70 lines |

8.2% is below the 14.6% the same limits give on the JavaScript corpus. Most of what remains is a finding just over a limit, not noise.

The three Python checks were quiet on this corpus. Across the 159 commits, no `breakpoint()` and no broad `except: pass` was added. One commit added a `print()` to product code, which is black telling the user it needs a newer Python, and one added public functions nothing imports. Both only warn.

## Catching planted problems

One known problem at a time was added to 10 product files in each project, and the gate run on that change: 800 changes in all.

| Planted problem | Rule | Caught |
|---|---|---|
| Nesting pyramid | `depth` | 79 of 80 |
| Function over 60 lines | `lines` | 79 of 80 |
| Six required parameters | `params` | 79 of 80 |
| Bare `# noqa` | `suppression` | 80 of 80 |
| One function split into five that add 30 to a file | `file-added-cognitive` | 79 of 80 |
| Copy of a 12 to 60 line function from another file | `clone` | 79 of 80 |
| `breakpoint()` left in a function | `debugger` | 79 of 80 |
| `except Exception: pass` | `swallowed-error` | 79 of 80 |
| `print()` left in a function (advice) | `console` | 79 of 80 |
| A new public function nothing imports (a warning) | `unused-export` | 68 of 80 |

That is 780 of 800, or 97.5%, against the JavaScript corpus's 97%.

The misses fall into two groups:
- **One file in black**, `profiling/list_huge.py`, is too large for the parser. In a project the gate warns that it could not read the change, and in a benchmark it fails it.
- **Eleven unused functions** were added to modules that declare `__all__`, nine of them in httpx. A function such a module does not list is not an export, so the gate does not report it. That is the rule as written, not a miss of it.

## Why three of the Python findings are advice

- **`print()`:** it is how a command-line tool talks. The one `print()` the corpus added was a message for the user. `breakpoint()` and `pdb.set_trace()` have no such use and fail.
- **Passing on one named exception:** `except KeyError: pass` is often meant. Catching everything and doing nothing, with a bare `except:`, `except Exception:` or `except BaseException:`, fails.
- **An unused export:** in an application a public function nothing imports is dead code. In a library it can be the interface, and the gate cannot tell the two apart. A decorated function is never reported, because a decorator often registers it, and neither is anything in `__init__.py` or `__main__.py`.

## Known gaps

- **Dynamic use:** a name reached through `getattr`, an entry point in packaging metadata or a plugin registry counts as unused. It is only a warning for that reason.
- **Imports by path:** an absolute import is matched against the end of a file's path, because the gate does not know a project's import roots. Two modules with the same trailing path are not told apart.
- **Other debugging:** `logging.debug`, `icecream` and a stray `pprint` are not looked for.
- **Corpus:** eight well-known libraries and tools. No web application or data pipeline is in it, and those print and catch differently.

## Re-run on the second version of the gate

The Python checks were then moved onto the second gate, and the same corpus and scripts were run again at the same commits. Python now reports under the rule names the other languages use, and the second gate decides from the name whether a finding fails or is advice: `debugger` and `swallowed-error` fail, `console`, `empty-catch` and `unused-export` are advice. Its checks were also widened after review:
- `set_trace()` is caught however pdb, ipdb or pudb was imported, not only as `pdb.set_trace()`.
- A broad type anywhere in a tuple, as in `except (ValueError, Exception): pass`, fails like a bare `except:`.
- A test may still print and pass on one named error, but a debugger or a catch-all that does nothing fails in a test too.
- A switch that hides a whole file (`# flake8: noqa`, `# ruff: noqa`, `# pylint: skip-file`, `# mypy: ignore-errors`) or every rule (`# pylint: disable=all`) is never reasoned. A `# noqa` or pylint pragma later in a comment counts, as those tools read it; a `# type: ignore` only at the start of a comment, as type checkers read it.

| | Before | After |
|---|---|---|
| Known-good commits that fail | 13 of 159 (8.2%) | 13 of 159 (8.2%) |
| Planted problems caught | 780 of 800 (97.5%) | 780 of 800 (97.5%) |

The same 13 commits fail, on the same rules. One intermediate version also failed a black commit whose comment explains, in prose, that a `# type: ignore` must come first in a comment; reading `# type: ignore` only at the start of a comment removed it, and that line is now a test.

