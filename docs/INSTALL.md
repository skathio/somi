# Installation

SoMi AI is distributed as a **Claude Code plugin** (via marketplace) and as a **GitHub Copilot
extension** (via the Copilot plugin marketplace).

---

## Claude Code — plugin (marketplace)

The marketplace path is the recommended way to install SoMi AI into Claude Code.

```text
# 1. Register the SoMi AI marketplace source.
/plugin marketplace add https://github.com/skathio/somi-ai

# 2. Install the plugin.
/plugin install somi-ai@somi-ai
```

Once installed, `/plan`, `/code`, `/code-loop`, `/review`, `/ship`, `/ship-loop`, `/plan-loop`,
`/security-review`, `/architecture-review`, `/test-strategy`, and `/refactor` will appear in
Claude Code's `/` autocomplete.

### How hooks load on plugin install

The plugin ships `hooks/hooks.json`, which Claude Code automatically merges into the active hook
configuration when the plugin is enabled. Hook commands resolve via `${CLAUDE_PLUGIN_ROOT}` — a
variable the harness provides for plugin-bundled scripts. **You do not need to edit
`.claude/settings.json` for hooks to fire on a plugin install.**

Verify hooks are loaded after install:

```text
/plugin info somi-ai
```

If hooks are listed under "Hooks", the deterministic guardrails are live.

### Updating

```text
/plugin update somi-ai
```

### Pinning a version

```text
/plugin pin somi-ai 0.1.0
```

Pinning is recommended for teams that want to adopt new versions deliberately rather than
automatically.

### Uninstalling

```text
/plugin uninstall somi-ai
```

---

## Claude Code — vendored (without the plugin marketplace)

If you'd rather copy SoMi AI into your project directly (no marketplace), you can vendor it:

```bash
git clone https://github.com/skathio/somi-ai .claude/plugins/somi-ai
```

Then merge the **`hooks` block** and **`permissions` block** from
[`.claude/settings.json`](../.claude/settings.json) into your project's own `.claude/settings.json`.
Vendored installs use `${SOMI_VENDOR_ROOT}` (defaulted to `${CLAUDE_PROJECT_DIR}/.claude/plugins/somi-ai`)
so the hook paths resolve.

This is the path covered by the `.claude/settings.json` shipped in this repo. The plugin install
path uses `hooks/hooks.json` instead.

---

## GitHub Copilot — extension marketplace

SoMi AI is also a GitHub Copilot extension, distributed through the same marketplace pattern as
the Claude Code plugin. The `.copilot-extension/` manifests mirror `.claude-plugin/` exactly —
both point at the same agent/command/skill/rules files.

### Install

```text
copilot plugin marketplace add https://github.com/skathio/somi-ai
copilot plugin install somi-ai@somi-ai
```

### Using the extension

Once installed, use `@somi-ai` in GitHub Copilot chat:

```text
@somi-ai /plan  Add per-team rate limiting to the public webhook endpoint
@somi-ai /code  rate-limiting-webhooks phase 1, iteration 1
@somi-ai /code-loop  rate-limiting-webhooks phase 1, iteration 1
@somi-ai /review  rate-limiting-webhooks
@somi-ai /review  plan rate-limiting-webhooks         # plan-level review (no separate /plan-review)
@somi-ai /ship  Full plan → code → review pipeline for: add audit logging
@somi-ai /security-review  rate-limiting-webhooks
@somi-ai /architecture-review  rate-limiting-webhooks
@somi-ai /test-strategy  rate-limiting-webhooks
@somi-ai /refactor  Untangle the payment service before patching
```

### Updating

```text
copilot plugin update somi-ai
```

---

## Prerequisites

| Distribution | Requirements |
|---|---|
| Claude Code plugin | Claude Code with `/plugin` support |
| Vendored install | Same, plus a project `.claude/settings.json` you control |
| Copilot extension | GitHub Copilot subscription |

For lint hooks to run: the linter your project uses (`ruff`, `eslint`, `go vet`, etc.) must be on
`$PATH`. Missing linters are silently skipped rather than failing.

For the dep-install gate (`SOMI_ALLOW_DEP_INSTALL=1` opt-in): see [HOOKS.md](./HOOKS.md).

---

## Verifying the install

**Claude Code (plugin)**: type `/` — you should see `/plan`, `/code`, `/code-loop`, `/review`,
`/ship`, `/ship-loop`, `/plan-loop` in autocomplete. Try `/plan list a trivial change` to confirm
the planner agent loads. Then run `/plugin info somi-ai` to confirm hooks are registered.

**Claude Code (vendored)**: confirm `.claude/settings.json` in your project includes the SoMi AI
hooks block (paths under `${SOMI_VENDOR_ROOT}/hooks/…`). The auto-generated `.claude/audit.log`
appearing after the first session is a good sign hooks are firing.

**Copilot extension**: type `@somi-ai /plan test` in Copilot chat — SoMi AI should respond with
a structured plan.

If something is missing in Claude Code, check with `/plugin info somi-ai`.

---

## Troubleshooting

- **Hooks don't fire (plugin install)**: confirm with `/plugin info somi-ai` that hooks are
  listed; if not, the plugin's `hooks/hooks.json` may not have been merged. Re-enable the plugin
  or open an issue.
- **Hooks don't fire (vendored install)**: confirm `${SOMI_VENDOR_ROOT}` resolves to the directory
  that contains `hooks/`. The `env` block in your `.claude/settings.json` controls this.
- **`/plan` not visible after install**: reload the Claude Code window. Commands load at session
  start.
- **Copilot extension: `@somi-ai` not found**: confirm the extension is installed with
  `copilot plugin list` and that your Copilot subscription is active.

See also: [HOOKS.md](./HOOKS.md), [USAGE.md](./USAGE.md), [PLUGIN.md](./PLUGIN.md).
