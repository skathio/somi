# Hooks

Hooks are **deterministic guardrails**. They run in Claude Code's hook framework (not in the model)
and can block, modify, or log tool calls without consulting the agent's judgment. SoMi uses hooks for
non-negotiables and uses agents for judgment-heavy work.

> **Claude Code only.** Hooks are a Claude Code host capability. On the **GitHub Copilot** extension
> they do **not** run — none of the blocks below are enforced and nothing is written to the audit
> log. The agent/skill/rule judgment still applies on Copilot, but the *hard stops* in this document
> are specific to the Claude Code plugin. See the parity caveat in [`PLUGIN.md`](./PLUGIN.md).
> **Partial portable fallback:** [`scripts/somi-check.mjs`](../scripts/somi-check.mjs) (below) carries
> the working-tree subset of these guarantees to any host as a git pre-commit hook or CI step.

All hook scripts under `hooks/` are zero-dependency Node ES modules (`.mjs`), invoked as
`node <file>` — no `bash`, no `jq`. That makes the hook *runtime* itself Windows-native: `node
<file>` works the same on Windows, Linux, and macOS. One caveat, not yet closed: the path-matching
guards (`guard-protected-paths`, `block-secret-writes`) build their globs against forward-slash
paths, and their behavior against native Windows `\`-separated paths hasn't been verified yet — a
tracked follow-up, not a claim of full guard parity on Windows.

## What SoMi ships

| Event              | Matcher       | Script                                           | What it does                                                                                                                |
|--------------------|---------------|--------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| `PreToolUse`       | `Bash`        | `pre-tool/block-dangerous-bash.mjs`              | Denies `rm -rf /`, `curl \| sh`, force-push to protected branches **or without a verifiable target branch**, destructive SQL (case-insensitive), and shell-level writes to secret paths (`> .env`, `tee`, `sed -i`, `cp`/`mv`). Also matches inside `bash -c "…"` quoting. |
| `PreToolUse`       | `Bash`        | `pre-tool/gate-dep-install.mjs`                  | Denies `npm install <pkg>` / `pip install <pkg>` / `cargo add` / etc. without `SOMI_ALLOW_DEP_INSTALL=1` or a `.somi/config.json` `dep_install.allow` prefix match. Bare reinstall is allowed. |
| `PreToolUse`       | `Write\|Edit` | `pre-tool/block-secret-writes.mjs`               | Denies writes to `.env`, `*.pem`, `id_rsa`, secret YAML/JSON.                                                              |
| `PreToolUse`       | `Write\|Edit` | `pre-tool/guard-protected-paths.mjs`             | Denies writes to `.git/`, `node_modules/`, `dist/`, lockfiles, the SoMi plugin dir.                                     |
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
whose `Write|Edit` matcher those shapes would otherwise bypass. All checks also run against a
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
`__pycache__/`, and the SoMi plugin install itself (so agents can't rewrite their own ruleset under
you). Relative paths are normalised against the project root before matching, so
`node_modules/x.js` can't slip past the globs. Also blocks hand-editing of lockfiles by default —
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

## `somi-check` — the portable working-tree guard

Tool-call-time hooks are Claude Code-only; **commit-time and CI-time enforcement works
everywhere**. [`scripts/somi-check.mjs`](../scripts/somi-check.mjs) (also exposed as the
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
