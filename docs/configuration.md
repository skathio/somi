# Configuration

SoMi reads two config files, both optional, with the same shape:

- **Your own global file:** `~/.config/somi/config.json`, or `$XDG_CONFIG_HOME/somi/config.json` when that is set to an absolute path, or `%APPDATA%\somi\config.json` on Windows. `SOMI_GLOBAL_CONFIG` names another file, and set empty it turns the global file off.
- **The project's file:** `.somi/config.json` in the repository, usually committed.

The project's file is merged over yours: objects merge key by key, and any other value replaces. A file must be a JSON object of at most 64 KB. You rarely need to edit either by hand: ask `/somi-config` in the chat to show or change any of it.

## A project's config can only make things stricter

A project's config is cloned input, so it cannot loosen what protects you. It may tighten a quality limit, raise the quality level, add import rules, lengthen the gate's time, and put the security reviewer back on high. A looser value there is ignored, and the gate says so. Nothing in it can lower what fires a review, who reviews, or what `somi pr` refuses: those are constants in the code, not configuration. `somi launch` reads only your global file, so a project cannot choose the model a session starts on.

## Tiers

SoMi has three tiers, `low`, `medium` and `high`, mapped to models for each host:

```json
{ "tiers": { "main": "medium", "claude": { "low": "haiku", "medium": "sonnet", "high": "opus" }, "copilot": { "low": "<model>", "medium": "<model>", "high": "<model>" }, "ceiling": "high" } }
```

- **`main`** is the tier your conversation runs on, medium by default. Code is written on medium, in the conversation or in `/somi-deliver`'s build, and work above the conversation's tier goes up to a worker. After `main` changes, `/somi-config` runs `somi setup`, which writes `somi-main` to your own agent folder so the conversation runs on that tier's model.
- **`claude`** has the defaults shown above.
- **`copilot`** has none, because Copilot's models vary by plan. A tier with no model runs on the session's model, and `somi doctor` says so.
- **`ceiling`** caps every tier for a session or a project. It can only lower one.

| Role | Tier |
|---|---|
| The conversation, work you call sensitive, and fixes after a security signal | `main`, medium by default |
| Code work | medium, and one tier up when its checks fail |
| Finding files and running checks | low |
| Planning | medium |
| Design and security review | high |
| Code review | medium |

## The security reviewer's tier

When the diff shows security signals, the security reviewer runs on high, and any fix stays on `main`. In your own file, `review.security_tier` set to `medium` puts that reviewer alone on medium, while the high tier stays for work that climbs to it:

```json
{ "review": { "security_tier": "medium" } }
```

On the benchmark that cost 17–19% less per task but solved fewer small security tasks, so the default stays `high`. A project's config can only set it back to `high`, and a security review you ask for, such as `/somi review --security`, always runs on high.

## Quality limits

The quality gate checks what a change touched against limits on complexity, nesting, length, parameters, copied code, import cycles and suppressions, and gives advice on file size, options objects, swallowed errors, leftover debugging, tests that assert nothing and names nothing uses. It runs by itself when a turn that changed code ends, and `/somi-quality` runs it on demand. The rules behind it are in [the architecture](ARCHITECTURE.md#quality-gate).

The defaults:

| Kind | Cognitive | Nesting | Lines | Parameters |
|---|---|---|---|---|
| `function` | 15 | 4 | 60 | 4 |
| `component` (a UI component) | 15 | 4 | 150 | 4 |
| `test` | 8 | 3 | 150 | 4 |

A file may hold at most 100 in cognitive complexity, and one change may add at most 25 to a file in a commit or 100 in a pull request (`file.added_cognitive`). A copy is 100 tokens (`clones.tokens`), and a new suppression fails unless it states a reason (`suppressions.added` is 0).

Set your own under `quality` in your global file:

```json
{ "quality": { "function": { "cognitive": 15, "depth": 4, "lines": 60, "params": 4 } } }
```

Ask `/somi-config` to change one, and SoMi asks you before an agent writes a looser value. A project's `.somi/config.json` can only make a limit stricter.

### The quality level

The gate is strict by default. `quality.level` loosens it all at once, rather than limit by limit:

```json
{ "quality": { "level": "standard" } }
```

`standard` loosens each limit by about a third. `relaxed` puts the function limits near what the 99th percentile of well-kept projects' functions reach. No level allows a new suppression or loosens the rules that are not limits, such as a debugger left behind or a swallowed error. A limit you set under `quality` still applies after the level. A project's config may only make the level stricter, and the pull request text names the level when it is not strict.

### Commit, pull request and repository scopes

The gate runs at two scopes that share every limit except how much one change may add to a file. Give either its own values under `quality.commit` or `quality.pr`:

```json
{ "quality": { "commit": { "file": { "added_cognitive": 25 } }, "pr": { "file": { "added_cognitive": 100 } } } }
```

- **`quality.pr`** applies to the whole branch since it left the main branch, which is what goes into a pull request. It is the default for `/somi-quality` and for the end-of-turn gate.
- **`quality.commit`** applies to `/somi-quality commit`, which scores what a commit adds to the last one, and to `somi check`.
- **`quality.repo`** applies to `/somi-quality repo`, a report on the whole codebase as it stands: every function and file over a limit, every copy in product code and every suppression with no reason, the most complex functions and the files with the most findings first.

### Folders that must not import others

To keep layers apart, `quality.forbid_imports` names the folders that must not import others. Each rule only adds a restriction, so both files may set them, and a new import across one fails:

```json
{ "quality": { "forbid_imports": [{ "from": "src/ui/", "to": "src/db/" }] } }
```

Each rule needs `from` and `to`, each a path prefix of at most 200 characters, and a file may hold at most 100 rules.

### How long the gate may run

The gate may run for 300 seconds before it counts as failed. For a large change, set `quality.timeout_seconds`, a whole number from 10 to 1800, in your own file, or in the project's, which may only lengthen it:

```json
{ "quality": { "timeout_seconds": 900 } }
```

A gate that runs out of time is reported as that, and it is not a pass.

## The staged workflow on Copilot

On Copilot CLI, SoMi registers `/somi-deliver` at session start. To turn that off, set this in your global file:

```json
{ "copilot": { "workflows": false } }
```
