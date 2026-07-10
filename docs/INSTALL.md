# Installation

SoMi is distributed as a **Claude Code plugin** (via marketplace) and as a **GitHub Copilot
extension** (via the Copilot plugin marketplace).

---

## Claude Code — plugin (marketplace)

The marketplace path is the recommended way to install SoMi into Claude Code.

```text
# 1. Register the SoMi marketplace source.
/plugin marketplace add https://github.com/skathio/somi

# 2. Install the plugin.
/plugin install somi@somi
```

Once installed, the SoMi commands appear in Claude Code's `/` autocomplete: the build flows
(`/discover`, `/design`, `/plan`, `/plan-loop`, `/code`, `/code-loop`, `/code-parallel`,
`/review`, `/review-panel`, `/ship`, `/ship-loop`), debugging (`/debug`), the targeted reviews
(`/security-review`, `/architecture-review`, `/test-strategy`), refactoring (`/refactor`), the
repo-level utilities (`/atlas`, `/impact`, `/adopt`, `/somi`, `/pr`), and the lifecycle flows
(`/upgrade`, `/release-readiness`, `/incident`). For an existing codebase, run `/adopt` once
after installing; type `/somi` any time for status and routing.

### How hooks load on plugin install

The plugin ships `hooks/hooks.json`, which Claude Code automatically merges into the active hook
configuration when the plugin is enabled. Hook commands resolve via `${CLAUDE_PLUGIN_ROOT}` — a
variable the harness provides for plugin-bundled scripts. **You do not need to edit
`.claude/settings.json` for hooks to fire on a plugin install.**

Verify hooks are loaded after install:

```text
/plugin info somi
```

If hooks are listed under "Hooks", the deterministic guardrails are live.

### Updating

```text
/plugin update somi
```

### Pinning a version

```text
/plugin pin somi 0.1.0
```

Pinning is recommended for teams that want to adopt new versions deliberately rather than
automatically.

### Uninstalling

```text
/plugin uninstall somi
```

---

## Claude Code — vendored (without the plugin marketplace)

If you'd rather copy SoMi into your project directly (no marketplace), you can vendor it:

```bash
git clone https://github.com/skathio/somi .claude/plugins/somi
```

Then merge the **`hooks` block** and **`permissions` block** from
[`.claude/settings.json`](../.claude/settings.json) into your project's own `.claude/settings.json`.
Vendored installs use `${SOMI_VENDOR_ROOT}` (defaulted to `${CLAUDE_PROJECT_DIR}/.claude/plugins/somi`)
so the hook paths resolve.

This is the path covered by the `.claude/settings.json` shipped in this repo. The plugin install
path uses `hooks/hooks.json` instead.

---

## GitHub Copilot — extension marketplace

SoMi is also a GitHub Copilot extension, distributed through the same marketplace pattern as
the Claude Code plugin. The `.copilot-extension/` manifests mirror `.claude-plugin/` exactly —
both point at the same agent/command/skill/rules files.

### Install

```text
copilot plugin marketplace add https://github.com/skathio/somi
copilot plugin install somi@somi
```

### Using the extension

Once installed, use `@somi` in GitHub Copilot chat:

```text
@somi /plan  Add per-team rate limiting to the public webhook endpoint
@somi /code  rate-limiting-webhooks phase 1, iteration 1
@somi /code-loop  rate-limiting-webhooks phase 1, iteration 1
@somi /review  rate-limiting-webhooks
@somi /review  plan rate-limiting-webhooks         # plan-level review (no separate /plan-review)
@somi /ship  Full plan → code → review pipeline for: add audit logging
@somi /security-review  rate-limiting-webhooks
@somi /architecture-review  rate-limiting-webhooks
@somi /test-strategy  rate-limiting-webhooks
@somi /refactor  Untangle the payment service before patching
```

### Updating

```text
copilot plugin update somi
```

---

## Prerequisites

| Distribution | Requirements |
|---|---|
| Claude Code plugin | Claude Code with `/plugin` support |
| Vendored install | Same, plus a project `.claude/settings.json` you control |
| Copilot extension | GitHub Copilot subscription |
| Runtime (all install paths) | A current Node (LTS) on `PATH`. No `bash`, no `jq` — both were removed by the Node port. Both Claude Code and GitHub Copilot already bundle Node, so most users need nothing extra. |

The Node runtime itself is Windows-native (no bash/jq to install), so all three install paths work
on Windows as well as Linux/macOS. One open caveat: see [HOOKS.md](./HOOKS.md)'s note on Windows
path-separator coverage for the path-matching guards.

For lint hooks to run: the linter your project uses (`ruff`, `eslint`, `go vet`, etc.) must be on
`$PATH`. Missing linters are silently skipped rather than failing.

For the dep-install gate (`SOMI_ALLOW_DEP_INSTALL=1` opt-in): see [HOOKS.md](./HOOKS.md).

---

## Verifying the install

**Claude Code (plugin)**: type `/` — you should see `/somi`, `/discover`, `/plan`, `/code`,
`/code-loop`, `/review`, `/ship`, `/ship-loop`, `/plan-loop`, `/debug` (and the rest) in
autocomplete. Try `/somi` for the status dashboard, or `/plan list a trivial change` to confirm
the planner agent loads. Then run `/plugin info somi` to confirm hooks are registered.

**Claude Code (vendored)**: confirm `.claude/settings.json` in your project includes the SoMi
hooks block (paths under `${SOMI_VENDOR_ROOT}/hooks/…`). The auto-generated `.claude/audit.log`
appearing after the first session is a good sign hooks are firing.

**Copilot extension**: type `@somi /plan test` in Copilot chat — SoMi should respond with
a structured plan.

If something is missing in Claude Code, check with `/plugin info somi`.

---

## Troubleshooting

- **Hooks don't fire (plugin install)**: confirm with `/plugin info somi` that hooks are
  listed; if not, the plugin's `hooks/hooks.json` may not have been merged. Re-enable the plugin
  or open an issue.
- **Hooks don't fire (vendored install)**: confirm `${SOMI_VENDOR_ROOT}` resolves to the directory
  that contains `hooks/`. The `env` block in your `.claude/settings.json` controls this.
- **`/plan` not visible after install**: reload the Claude Code window. Commands load at session
  start.
- **Copilot extension: `@somi` not found**: confirm the extension is installed with
  `copilot plugin list` and that your Copilot subscription is active.

See also: [HOOKS.md](./HOOKS.md), [USAGE.md](./USAGE.md), [PLUGIN.md](./PLUGIN.md).
