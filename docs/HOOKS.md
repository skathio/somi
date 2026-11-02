# Hooks

Hooks are **deterministic guardrails**. They run in Claude Code's hook framework (not in the model)
and can block, modify, or log tool calls without consulting the agent's judgment. SoMi uses hooks for
non-negotiables and uses agents for judgment-heavy work.

> **Claude Code and Copilot CLI.** Both hosts run these hooks. On Copilot CLI (checked live on
> 1.0.103) `SessionStart`, the `PreToolUse` guards and the audit log fire; its file tools arrive in
> their own shapes (`Write` with `tool_input.path`, `Edit` carrying an `apply_patch` body), which the
> write guards read, refusing a write whose target they cannot read; and in a non-interactive run an
> `ask` verdict becomes a refusal. Whether an interactive Copilot CLI session shows the `ask` prompt is
> unverified. On **VS Code Copilot Chat** whether hooks run is unverified: assume none of the blocks
> below are enforced there. The agent/skill/rule judgment applies on every host. See the parity
> caveat in [`PLUGIN.md`](./PLUGIN.md).
> **Partial portable fallback:** [`scripts/somi-check.mjs`](../scripts/somi-check.mjs) (below) carries
> the working-tree subset of these guarantees to any host as a git pre-commit hook or CI step.

All hook scripts under `hooks/` are zero-dependency Node ES modules (`.mjs`), invoked as
`node <file>` — no `bash`, no `jq`. That makes the hook *runtime* itself Windows-native: `node
<file>` works the same on Windows, Linux, and macOS. One caveat: the path-matching
guards (`guard-protected-paths`, `block-secret-writes`) read `\` as `/`, treat a drive letter as an
absolute path, collapse `..`, `.` and `//`, and match `.git`, `.somi` and `.claude` case-insensitively,
but that is tested on Linux only, and Windows 8.3 short names (`PROGRA~1`) are not resolved.

## What SoMi ships

| Event              | Matcher       | Script                                           | What it does                                                                                                                |
|--------------------|---------------|--------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| `SessionStart`     | (any)         | `session-start/ensure-default-config.mjs`        | Creates `.somi/config.json` with default cost settings, only when nothing exists at that path and there is no global config. Never overwrites. |
| `PreToolUse`       | `Write\|Edit\|MultiEdit\|mcp__.*somi_config` | `pre-tool/guard-cost-lowering.mjs` | Asks the user before a change to `.somi/config.json` (through the `somi_config` MCP tool or a file edit) that would lower an agent's effective cost tier, judged over the global config, and before any file edit of the global config. Silent for raises, no-ops and every other call. |
| `PreToolUse`       | `Bash`        | `pre-tool/block-dangerous-bash.mjs`              | Denies `rm -rf /`, `curl \| sh`, force-push to protected branches **or without a verifiable target branch**, destructive SQL (case-insensitive), and shell-level writes to secret paths (`> .env`, `tee`, `sed -i`, `cp`/`mv`). Also matches inside `bash -c "…"` quoting. |
| `PreToolUse`       | `Bash`        | `pre-tool/gate-dep-install.mjs`                  | Denies `npm install <pkg>` / `pip install <pkg>` / `cargo add` / etc. without `SOMI_ALLOW_DEP_INSTALL=1` or a `.somi/config.json` `dep_install.allow` prefix match. Bare reinstall is allowed. |
| `PreToolUse`       | `Write\|Edit\|MultiEdit\|NotebookEdit` | `pre-tool/block-secret-writes.mjs`               | Denies writes to `.env`, `*.pem`, `id_rsa`, secret YAML/JSON.                                                              |
| `PreToolUse`       | `Write\|Edit\|MultiEdit\|NotebookEdit` | `pre-tool/guard-protected-paths.mjs`             | Denies writes to `.git/`, `node_modules/`, `dist/`, lockfiles, the SoMi plugin dir, and `.somi/somi-state/{tier,loop,run}/`. |
| `PostToolUse`      | `Write\|Edit` | `post-tool/lint-changed-files.mjs`               | Runs the project's linter on the changed file; surfaces output back to the model via `hookSpecificOutput.additionalContext`. |
| `PostToolUse`      | `*`           | `post-tool/audit-log.mjs`                        | Appends every tool call to `.somi/audit.log`.                                                                              |
| `UserPromptSubmit` | (any)         | `user-prompt-submit/inject-workflow-context.mjs` | Injects a SoMi reminder + active work-item state on first turn / state-change; surfaces TODO(claude)/scratch-file loose ends every turn. |

All hooks live under `hooks/` in the repo. **Plugin install**: Claude Code auto-merges
[`hooks/hooks.json`](../hooks/hooks.json) (which uses `${CLAUDE_PLUGIN_ROOT}`) when the plugin is
enabled. **Vendored install**: copy/merge the hooks block from [`.claude/settings.json`](../.claude/settings.json)
into the consuming project's `.claude/settings.json` (uses `${SOMI_VENDOR_ROOT}`).

## The contract

Each hook script:

- Reads a JSON payload from stdin describing the tool invocation.
- Emits an **event-specific** JSON shape on stdout to control the harness. The shape depends on
  the event:

  | Event              | Block/deny shape                                                                                  | Context shape                                                  |
  |--------------------|---------------------------------------------------------------------------------------------------|----------------------------------------------------------------|
  | `PreToolUse`       | `{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"deny", permissionDecisionReason:"…"}}` | (use the deny shape — no separate context channel)             |
  | `PostToolUse`      | `{decision:"block", reason:"…"}`                                                                  | `{hookSpecificOutput:{hookEventName:"PostToolUse", additionalContext:"…"}}` |
  | `UserPromptSubmit` | `{decision:"block", reason:"…"}`                                                                  | `{hookSpecificOutput:{hookEventName:"UserPromptSubmit", additionalContext:"…"}}` |
  | `Stop`             | `{decision:"block", reason:"…"}`                                                                  | **No additionalContext channel for Stop** — restructure as PostToolUse or UserPromptSubmit if you need context. |

- Exits non-zero only on true errors (the hook itself failed); a deny is *not* an error.
- Each hook is an ES module (`hooks/<event>/<name>.mjs`), invoked as `node <file>`, importing the
  helpers it needs from [`hooks/lib/common.mjs`](../hooks/lib/common.mjs):
  - `readPayload()` — read and parse the stdin JSON payload once.
  - `field(payload, '.dotted.path')` — extract a payload field.
  - `denyPretool(payload, reason)` — emit a `PreToolUse` deny (and audit it).
  - `contextOutput(event, text)` — emit `hookSpecificOutput.additionalContext` for an event.
  - `audit(payload, kind, detail)` — append a line to `.somi/audit.log`.
  - `matchesAny(str, patterns)` / `matchesAnyNocase(str, patterns)` — regex match helpers.
  - `runHook(main)` — the standard top-level wrapper every hook calls itself with.

See the `.mjs` files under `hooks/` for canonical implementations.

## Hook behaviour, in plain language

### `block-dangerous-bash.mjs`

A static list of regex patterns covering the most-common shapes of destructive shell commands.
False positives are tolerated; false negatives are not. The agent must **not work around a deny** —
if the human really wants to run the command, the human runs it themselves.

Covers: nuke `rm -rf`, fork bombs, raw `dd if=.. of=/dev/sd*`, `mkfs`, supply-chain `curl|sh`,
destructive git on protected branches (force, force-with-lease, refspec form, `+refspec` form),
**force-push without an explicit target branch** (`git push -f`, `… origin`, `… origin HEAD` — the
current branch can't be verified and may be protected; naming the branch is what makes the
protected-branch check meaningful), destructive SQL (`DROP DATABASE`, `DROP SCHEMA prod`,
`DROP TABLE …`, `TRUNCATE …`, `DELETE FROM x;` — case-insensitive), `--no-verify` on commit/push,
and **shell-level writes to secret-bearing paths** (`> .env`, `>> …/.env`, `tee .env`,
`sed -i … .env`, `cp`/`mv` onto a secret path) — the Bash-side twin of `block-secret-writes.mjs`,
whose `Write|Edit|MultiEdit|NotebookEdit` matcher those shapes would otherwise bypass. All checks also run against a
**quote-stripped copy** of the command, so `bash -c "rm -rf /"` can't hide inside quoting.

### `gate-dep-install.mjs`

Adding a runtime dependency crosses a trust boundary — it imports unreviewed code and creates
maintenance debt. This hook denies `npm install <pkg>`, `pip install <pkg>`, `cargo add`,
`go get`, `brew install`, etc. unless the human has set `SOMI_ALLOW_DEP_INSTALL=1` in the
environment for the session, **or** the project allowlists the package by prefix in
`.somi/config.json` (`dep_install.allow`, e.g. `["@types/"]`) — committed, reviewable, scoped
policy instead of the all-or-nothing session switch. The allowlist is conservative: compound
commands never qualify, and every package in the command must match a prefix. **Bare
lockfile-respecting reinstalls** (`npm install`, `bundle install`, etc., with no package
argument) are allowed — those materialize what's already declared.

### `block-secret-writes.mjs`

Refuses to write/edit files whose basename matches a secret-bearing pattern (`.env`, `*.pem`, `*.key`,
`id_rsa`, `service-account*.json`, `secrets.{yaml,json}`, etc.). Explicit example files (`.env.example`,
`.env.template`) are allowed.

### `guard-protected-paths.mjs`

Refuses to write to paths owned by tooling: `.git/`, `node_modules/`, `dist/`, `build/`, `target/`,
`__pycache__/`, the SoMi plugin install itself (so agents can't rewrite their own ruleset under
you), and the sizing, loop and run-budget state under `.somi/somi-state/{tier,loop,run}/`. Scripts write
that state from node, which no hook sees; only an agent's file-tool write is refused. Paths are resolved
against the project root before matching (`\` read as `/`, `..`, `.` and `//` collapsed), so `node_modules/x.js`,
`.git\config` and `.somi/plans/../somi-state/loop/x.json` can't slip past the globs, and a write at a protected
directory's own path (`.git`, `.somi/somi-state/loop`) is refused. Also blocks hand-editing of lockfiles by default —
those should be regenerated by package managers. Override per-session with
`SOMI_ALLOW_LOCKFILES=1`, or as committed project policy with `lockfiles.allow_edit: true` in
`.somi/config.json` (env wins, including `=0` to re-deny for a session).

### `lint-changed-files.mjs`

After every `Write` / `Edit`, runs the project's linter on the changed file if available
(`ruff`, `eslint`, `go vet`, `cargo clippy`, `shellcheck`). Output is surfaced back to the model via
`hookSpecificOutput.additionalContext` so it can self-correct on the next turn. Does **not** block —
the file is already written by the time post-tool hooks run.

### `audit-log.mjs`

Appends `<timestamp>\t<kind>\t<tool>\t<summary>` to `.somi/audit.log` for every tool call. Pairs
with the `DENY` entries written by pre-tool hooks. Grep the audit log when you want to know exactly
what tools the agent touched during a session.

### `inject-workflow-context.mjs`

Two responsibilities, both surfaced via `hookSpecificOutput.additionalContext` on
`UserPromptSubmit`:

1. **Reminder block** — fires on the first turn of a session or when work-item state has changed
   since the last turn (signature based on `.somi/plans/**/progress.md` and
   `.somi/reviews/**/*.md` mtimes). Avoids double-loading content that's already always-on. The
   reminder includes the active work-item slug if exactly one is in-progress.
2. **Loose-end nudges** — fires whenever the working tree has `TODO(claude)` / `FIXME(claude)`
   markers (vs. HEAD) or stray `.bak` / scratch files. Replaces the old `Stop` hook, which used a
   channel Stop events don't actually have.

State file: `.somi/somi-state/last-context-signature` (project-local, gitignored).

### `ensure-default-config.mjs`

On `SessionStart`, if the project has **no** `.somi/config.json` and there is **no global config**
([`docs/USAGE.md`](./USAGE.md#the-global-config)), writes one holding the default
cost settings: `cost.ceiling` set to the built-in default (`medium`) and every shipped agent pinned
to its default tier (the table is `scripts/lib/cost-defaults.mjs`, kept equal to the
set of `agents/*.md` by `tests/scripts/cost-defaults.sh`). Without it, every agent would follow the
ceiling and the ones built for the strongest tier would run lower. It then prints one short notice
through `additionalContext`. With a global config it writes nothing: the global file holds the
defaults, and a fully pinned project copy would mask every later change to it.

What it will not do:

- **Never overwrites or touches an existing file of any kind** at `.somi/config.json`: valid, invalid
  JSON, a symlink (even a dangling one), or a directory. Only "nothing there" (`lstat` ENOENT)
  triggers a write.
- **Never writes through a link.** If `.somi` is a symlink or a regular file, nothing is written. The file
  is opened with `O_CREAT|O_EXCL|O_NOFOLLOW`, so a race or a link planted at the path is never
  written through. `.somi` is created (mode `0700`) only when absent.
- **Writes nothing but that one file**, and its content is a fixed constant, never derived from any
  existing file.
- **Never blocks a session.** Exit code is `0` on every path, including a read-only directory, and it
  prints no file content or error text.

When a config already exists (the project's, the global one, or both), the hook only reads the
effective config, through the same loader as the resolver (links followed, regular files of at most
64 KiB). If it has no valid `cost.agents["somi-security-reviewer"]` tier, it
prints one fixed notice that `somi-security-reviewer` runs at the ceiling (below `high` by default) and
that pinning it under `cost.agents` keeps the strong pass. If the entry exists but pins it to `low` or `medium`, it prints a different fixed notice
saying its security reviews run at that lower tier; with a global config both notices name it.
Nothing from a file reaches the notice, an unparsable, oversize or non-regular file stays silent (the
resolver already reports those), and no file is written.

To change the settings afterwards, run `/somi-config` or edit the `cost` block of `.somi/config.json`.

**GitHub Copilot.** On Copilot CLI this hook runs (checked live on 1.0.103: it wrote the default
config). On VS Code Copilot Chat it is unverified. On a host where this hook does not run, the project simply has no default file and every agent
follows the ceiling (`medium`); run `/somi-config` and choose the default config (the `somi_config` tool's `init` action), or create
and edit `.somi/config.json` by hand.

### `guard-cost-lowering.mjs`

A model steered by injected text could lower `somi-security-reviewer` or the ceiling through the
`somi_config` MCP tool or by editing `.somi/config.json`, and any warning would reach only that model.
This hook makes lowering a tier the user's decision. It computes what the change would do, using the
same edit code the tool uses (`scripts/lib/cost-config-edit.mjs`), and if it **lowers** anything it answers
`permissionDecision: "ask"` with a plain-text reason, so the host shows the user a prompt the model cannot
answer. It covers:

- the `somi_config` tool (`set` and `unset`; any plugin-namespaced name ending in `somi_config`), and
- the `somi_resolve` tool when it is given a `ceiling` ranking below the ceiling now in force (the config's, else
  a persisted one, else the default): a model-supplied lower ceiling needs the user, because it persists as
  an explicitly set value, and
- any `Write`, `Edit` or `MultiEdit` of the persisted ceiling file `.somi/somi-state/ceiling.json` (every write
  there asks; it is the other way to lower the ceiling), and
- `Write`, `Edit` and `MultiEdit` of the project's `.somi/config.json` (the path is resolved against the
  project root, so `.somi/../.somi/config.json` and a symlinked `.somi` resolve to the same file), and
- any `Write`, `Edit` or `MultiEdit` of the **global config**, whatever it changes: that file applies to
  every project and session, and the `somi_config` tool never writes it.

Both sides of a project change are judged as the resolver sees them: the global config with the
project file merged over it. A project file that drops an agent below its global pin is a lowering.

A change lowers when `somi-security-reviewer` would run below `high` (even if that was already so: an explicit
`low` pin is always flagged, though an identical before and after is a no-op), when the ceiling drops, when
any agent's effective tier drops (including removing a pin that sat above the ceiling), or when the new
content is unparsable or invalid. The rules live in `scripts/lib/cost-lowering.mjs`. Raises and no-ops are
silent, and so is every unrelated tool call. The reason is built from fixed strings and never echoes file
content. For a config-file path the hook fails closed to the user: an edit that cannot apply, content that
does not parse, or any internal error asks.

A config that has no `cost.ceiling` after the change is judged against the worst case, whatever persisted
ceiling exists now or appears later: deleting `cost.ceiling` is a lowering unless the removed value was
already `low`, and unpinning an agent in a config without a ceiling is too (otherwise the ceiling could be
deleted first and a low one planted afterwards). Otherwise the ceiling is compared the way the resolver
sees it, with a persisted flag/env ceiling as the fallback for an absent `cost.ceiling`. When the tool is given a
`project_dir` it is evaluated instead of the host root if it resolves inside it, and anything else asks.
Whether a path is the config is decided by file identity (same inode, same directory, any letter case), not
by how it is spelled. A change that leaves `somi-security-reviewer` below `high` without lowering anything else
gets its own wording rather than "lowers".

Where no SoMi hook can ask about the tool's write, the `somi_config` tool refuses a lowering (and a
`cost.mapping` change) itself: it passes `--refuse-lowering` to the CLI whenever `CLAUDE_PLUGIN_ROOT` is
not set in the MCP server's environment, or `COPILOT_PLUGIN_ROOT` is (Copilot CLI sets both, but names
the tool `somi-somi_config`, which this hook's matcher does not catch), exit `64`, and asks the model to have the
user run the CLI. The CLI run directly by the user is never restricted.

Limits, accepted and worth knowing:

- Other MCP servers' write tools, `Bash` (`sed -i`, `echo >`) and any other way of changing the file are not
  covered; `Bash` has its own permission gate.
- The `CLAUDE_PLUGIN_ROOT` test is a **heuristic** for "a hook can ask". It **fails open when hooks are
  disabled** while that variable is still set: the tool then neither refuses nor is asked about.
- How `ask` behaves under a host's bypass or auto-accept permission modes, and in headless runs with no one
  to answer, is **unverified**. This gate is not claimed to cover those modes.
- The hook reads the config and the persisted ceiling at the project root (or the evaluated `project_dir`);
  the session's own `SOMI_COST_CEILING` is not visible to it.
- A vendored install lists the hook in `.claude/settings.json`. This repo's own copy is kept in step by hand;
  no gate compares it with `hooks/hooks.json`.

## `somi-check` — the portable working-tree guard

Tool-call-time hooks run on Claude Code and Copilot CLI only; **commit-time and CI-time enforcement
works everywhere**. [`scripts/somi-check.mjs`](../scripts/somi-check.mjs) (also exposed as the
`somi-check` npm bin) re-checks the working-tree subset of the hook guarantees:

- staged **secret-bearing files** (same basename patterns as `block-secret-writes.mjs`;
  `.env.example`-style templates allowed),
- staged **lockfile hand-edits** (a lockfile changing without its manifest; honors
  `.somi/config.json` `lockfiles.allow_edit` and `SOMI_ALLOW_LOCKFILES`, env winning),
- added **`TODO(claude)` / `FIXME(claude)` markers**, and **scratch/backup files**.

Exit `1` on findings — wire it as a git `pre-commit` hook or a CI step:

```bash
# pre-commit (somi-check.mjs carries a `#!/usr/bin/env node` shebang and is executable)
ln -s ../../<path-to-somi>/scripts/somi-check.mjs .git/hooks/pre-commit
# CI
node <path-to-somi>/scripts/somi-check.mjs --all
```

This is **defense-in-depth on Claude Code** (hooks can't stop a human or another tool committing
a secret) and the **only enforcement layer on Copilot / bare setups**. It is coarser than the
hooks — commit-time, not tool-call-time — but it is real. Behavioral tests live in
`tests/scripts/run.sh`.

## Testing hooks (behavioral fixtures)

The guardrails' entire value is determinism — so they are tested behaviorally, not just linted.
[`tests/hooks/run.sh`](../tests/hooks/run.sh) pipes fixture payloads into each pre-tool script
under a sanitized environment (session opt-ins unset unless the case sets them; audit writes go
to a temp file) and asserts the deny/allow decision. Fixtures live in
[`tests/hooks/cases/`](../tests/hooks/cases/), one JSON file per script:

```json
{
  "script": "pre-tool/block-dangerous-bash.mjs",
  "cases": [
    { "name": "rm-rf-root", "expect": "deny",
      "payload": { "tool_name": "Bash", "tool_input": { "command": "rm -rf /" } } }
  ]
}
```

The suite runs in `scripts/validate.sh` (`npm test`) and therefore in CI. **If you change a
pattern, add or update a fixture** — a pattern change that silently weakens a guarantee should
fail CI, not be discovered in an incident.

## Why hooks instead of agent rules

For the things hooks cover, **judgment isn't the right tool**. We don't want the agent to think hard
about whether `rm -rf /` is safe today; we want it deterministically refused. Hooks remove the
attack-surface where a clever prompt convinces an otherwise-careful agent to bypass a guardrail.

For the things agents cover (planning, design judgment, review nuance), **rules aren't precise enough**
to encode the right behavior; we need a thinking process. The split is intentional.

## Extending hooks

To add a new hook:

1. Write an ES module under `hooks/<event-name>/<name>.mjs` following the convention (import the
   helpers you need from `lib/common.mjs`, read the payload, emit the event-specific shape, wrap
   your entry point in `runHook(main)`). No shebang or exec bit needed — hooks run as `node <file>`.
2. Add an entry in [`hooks/hooks.json`](../hooks/hooks.json) (plugin path) **and** in
   [`.claude/settings.json`](../.claude/settings.json) (vendored-install reference) under the
   appropriate event. Keep them in sync.
3. Add behavioral fixtures under [`tests/hooks/cases/`](../tests/hooks/cases/) — at minimum one
   deny and one allow case per rule the hook enforces.
4. Open a PR — CI runs `node --check` on the new script, validates the JSON wiring, and runs the
   fixture suite.

Local-only hooks: put them in your project's `.claude/settings.local.json` (which is gitignored). That
way you can experiment without affecting teammates.

## Disabling a SoMi hook for a session

Project-level: in your `settings.local.json`, repeat the same event/matcher with an empty `hooks` array
to override SoMi for that path. Better: file an issue against SoMi so the rule itself gets fixed.

User-level: never edit SoMi plugin scripts directly. Override in your local settings instead.

## What happens when a hook denies

The agent receives the deny's reason string back as a tool error. SoMi's `rules/CLAUDE.md` tells
the agent **not** to work around a deny — instead, explain to the human what it was trying to do and
ask. If a hook fires unexpectedly often, the bug is either in the agent's plan or in the hook — either
way, surface it to the human rather than route around it.
