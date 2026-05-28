# Hooks

Hooks are **deterministic guardrails**. They run in Claude Code's hook framework (not in the model)
and can block, modify, or log tool calls without consulting the agent's judgment. SoMi AI uses hooks for
non-negotiables and uses agents for judgment-heavy work.

## What SoMi AI ships

| Event              | Matcher       | Script                                           | What it does                                                                                                                |
|--------------------|---------------|--------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| `PreToolUse`       | `Bash`        | `pre-tool/block-dangerous-bash.sh`               | Denies `rm -rf /`, `curl \| sh`, `git push --force[-with-lease]` to protected branches, destructive SQL (case-insensitive), etc. |
| `PreToolUse`       | `Bash`        | `pre-tool/gate-dep-install.sh`                   | Denies `npm install <pkg>` / `pip install <pkg>` / `cargo add` / etc. without `SOMI_ALLOW_DEP_INSTALL=1`. Bare reinstall is allowed. |
| `PreToolUse`       | `Write\|Edit` | `pre-tool/block-secret-writes.sh`                | Denies writes to `.env`, `*.pem`, `id_rsa`, secret YAML/JSON.                                                              |
| `PreToolUse`       | `Write\|Edit` | `pre-tool/guard-protected-paths.sh`              | Denies writes to `.git/`, `node_modules/`, `dist/`, lockfiles, the SoMi AI plugin dir.                                     |
| `PostToolUse`      | `Write\|Edit` | `post-tool/lint-changed-files.sh`                | Runs the project's linter on the changed file; surfaces output back to the model via `hookSpecificOutput.additionalContext`. |
| `PostToolUse`      | `*`           | `post-tool/audit-log.sh`                         | Appends every tool call to `.claude/audit.log`.                                                                            |
| `UserPromptSubmit` | (any)         | `user-prompt-submit/inject-workflow-context.sh`  | Injects a SoMi AI reminder + active work-item state on first turn / state-change; surfaces TODO(claude)/scratch-file loose ends every turn. |

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
- Sources `hooks/lib/common.sh` for the helpers:
  - `somi::read_payload` — read stdin once.
  - `somi::field <jq-path>` — extract a payload field.
  - `somi::deny_pretool <reason>` — emit a `PreToolUse` deny.
  - `somi::context <event> <text>` — emit `hookSpecificOutput.additionalContext` for an event.
  - `somi::audit <kind> <detail>` — append to `.claude/audit.log`.
  - `somi::matches_any[_nocase] <cmd> <patterns…>` — regex match helpers.

See the bash files for canonical implementations.

## Hook behaviour, in plain language

### `block-dangerous-bash.sh`

A static list of regex patterns covering the most-common shapes of destructive shell commands.
False positives are tolerated; false negatives are not. The agent must **not work around a deny** —
if the human really wants to run the command, the human runs it themselves.

Covers: nuke `rm -rf`, fork bombs, raw `dd if=.. of=/dev/sd*`, `mkfs`, supply-chain `curl|sh`,
destructive git on protected branches (force, force-with-lease, refspec form), destructive SQL
(`DROP DATABASE`, `DROP SCHEMA prod`, `DROP TABLE …`, `TRUNCATE …`, `DELETE FROM x;` —
case-insensitive), `--no-verify` on commit/push.

### `gate-dep-install.sh`

Adding a runtime dependency crosses a trust boundary — it imports unreviewed code and creates
maintenance debt. This hook denies `npm install <pkg>`, `pip install <pkg>`, `cargo add`,
`go get`, `brew install`, etc. unless the human has set `SOMI_ALLOW_DEP_INSTALL=1` in the
environment for the session. **Bare lockfile-respecting reinstalls** (`npm install`,
`bundle install`, etc., with no package argument) are allowed — those materialize what's already
declared.

### `block-secret-writes.sh`

Refuses to write/edit files whose basename matches a secret-bearing pattern (`.env`, `*.pem`, `*.key`,
`id_rsa`, `service-account*.json`, `secrets.{yaml,json}`, etc.). Explicit example files (`.env.example`,
`.env.template`) are allowed.

### `guard-protected-paths.sh`

Refuses to write to paths owned by tooling: `.git/`, `node_modules/`, `dist/`, `build/`, `target/`,
`__pycache__/`, and the SoMi AI plugin install itself (so agents can't rewrite their own ruleset under
you). Also blocks hand-editing of lockfiles by default — those should be regenerated by package
managers. Override per-session with `SOMI_ALLOW_LOCKFILES=1`.

### `lint-changed-files.sh`

After every `Write` / `Edit`, runs the project's linter on the changed file if available
(`ruff`, `eslint`, `go vet`, `cargo clippy`, `shellcheck`). Output is surfaced back to the model via
`hookSpecificOutput.additionalContext` so it can self-correct on the next turn. Does **not** block —
the file is already written by the time post-tool hooks run.

### `audit-log.sh`

Appends `<timestamp>\t<kind>\t<tool>\t<summary>` to `.claude/audit.log` for every tool call. Pairs
with the `DENY` entries written by pre-tool hooks. Grep the audit log when you want to know exactly
what tools the agent touched during a session.

### `inject-workflow-context.sh`

Two responsibilities, both surfaced via `hookSpecificOutput.additionalContext` on
`UserPromptSubmit`:

1. **Reminder block** — fires on the first turn of a session or when work-item state has changed
   since the last turn (signature based on `.somi/plans/**/progress.md` and
   `.somi/reviews/**/*.md` mtimes). Avoids double-loading content that's already always-on. The
   reminder includes the active work-item slug if exactly one is in-progress.
2. **Loose-end nudges** — fires whenever the working tree has `TODO(claude)` / `FIXME(claude)`
   markers (vs. HEAD) or stray `.bak` / scratch files. Replaces the old `Stop` hook, which used a
   channel Stop events don't actually have.

State file: `.claude/somi-state/last-context-signature` (project-local, gitignored).

## Why hooks instead of agent rules

For the things hooks cover, **judgment isn't the right tool**. We don't want the agent to think hard
about whether `rm -rf /` is safe today; we want it deterministically refused. Hooks remove the
attack-surface where a clever prompt convinces an otherwise-careful agent to bypass a guardrail.

For the things agents cover (planning, design judgment, review nuance), **rules aren't precise enough**
to encode the right behavior; we need a thinking process. The split is intentional.

## Extending hooks

To add a new hook:

1. Write a script under `hooks/<event-name>/` following the convention (source `lib/common.sh`,
   read the payload, emit the event-specific shape via the helpers).
2. `chmod +x` it.
3. Add an entry in [`hooks/hooks.json`](../hooks/hooks.json) (plugin path) **and** in
   [`.claude/settings.json`](../.claude/settings.json) (vendored-install reference) under the
   appropriate event. Keep them in sync.
4. Open a PR — CI runs ShellCheck and bash syntax check on the new script.

Local-only hooks: put them in your project's `.claude/settings.local.json` (which is gitignored). That
way you can experiment without affecting teammates.

## Disabling a SoMi AI hook for a session

Project-level: in your `settings.local.json`, repeat the same event/matcher with an empty `hooks` array
to override SoMi AI for that path. Better: file an issue against SoMi AI so the rule itself gets fixed.

User-level: never edit SoMi AI plugin scripts directly. Override in your local settings instead.

## What happens when a hook denies

The agent receives the deny's reason string back as a tool error. SoMi AI's `rules/CLAUDE.md` tells
the agent **not** to work around a deny — instead, explain to the human what it was trying to do and
ask. If a hook fires unexpectedly often, the bug is either in the agent's plan or in the hook — either
way, surface it to the human rather than route around it.
