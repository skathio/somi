# Extending SOMI

SOMI is opinionated, but it's a starting point — your team will want to add workflows, agents,
skills, hooks, and project-specific rules. This guide shows how.

## Mental model for extension

Pick the right layer for what you want to do:

| You want to…                                                | Add a…                          |
|-------------------------------------------------------------|---------------------------------|
| Encode a universal team standard                            | Rule (in your `99-overrides.md`)|
| Capture domain expertise for on-demand use                  | Skill                           |
| Give Claude a new specialised way of thinking               | Agent                           |
| Expose a new user-facing entrypoint                         | Command                         |
| Add a deterministic guardrail                               | Hook                            |
| Compose existing pieces into a new flow                     | Command (orchestrating agents)  |

When in doubt: lower-level → higher-level. Try a rule first; promote to a skill if it grows; promote
to an agent if it needs its own thinking process.

## Adding a new workflow

A workflow is a **named, durable flow** with a clear input and a clear artifact. Adding one is a
multi-piece change:

1. **Decide if it earns its own workflow.** Not everything does. The three SOMI workflows track the
   three fundamentally different shapes of engineering work. New workflows should also map to a
   distinct problem shape (e.g., **debugging** has a different shape than coding — diagnose, isolate,
   fix, regression-test).
2. **Define the artifact.** What durable output does the workflow produce? Write a template under
   `templates/<NAME>.md.tmpl`.
3. **Define the agent.** Add `agents/<workflow-agent>.md` with frontmatter and a full system prompt
   following the pattern of existing agents (when to invoke, operating procedure, quality bar, output
   shape, failure modes, escalation).
4. **Define the command.** Add `commands/<workflow>.md` orchestrating the agent and writing the
   artifact.
5. **Document it** in [WORKFLOWS.md](./WORKFLOWS.md) and [AGENTS.md](./AGENTS.md).
6. **Add to install profiles** as appropriate.
7. **Validate**: `scripts/validate.sh`.

## Adding an agent

`agents/<name>.md` with this frontmatter:

```markdown
---
name: <name>
description: When to invoke this agent (concrete trigger conditions, not topic). The model uses this to decide whether to call it.
tools: Read, Edit, Write, Bash, Grep, Glob, WebFetch
model: opus
---

# <name>

<body — see existing agents for the shape: when to invoke, when not to, operating procedure,
quality bar, output shape, failure modes to avoid, escalation rules, examples.>
```

Rules of thumb:

- **`description`** is the single most important field. Get it right.
- **`tools`** should be the minimum needed. Read-only agents (`reviewer`, `architecture-reviewer`)
  should not have `Edit`/`Write`.
- **`model`** defaults to `opus` for judgment-heavy work; `sonnet` for high-volume mechanical work.

## Adding a skill

`skills/<name>/SKILL.md`:

```markdown
---
name: <name>
description: Use when ... (trigger conditions in plain language).
---

# Skill body
```

Skills should include: when to invoke, first principles / operating procedure, per-domain checklists
or examples, anti-patterns, when *not* to apply, when to escalate. See existing skills for the shape.

## Adding a command

`commands/<name>.md`:

```markdown
---
description: One-liner for / autocomplete.
argument-hint: <how to phrase arguments>
allowed-tools: Task, Read, ...
model: opus
---

# /<name> — Title

(Command body — a prompt template. Reference $ARGUMENTS. Typically: validate input,
invoke agents via Task, write artifact, summarise.)
```

Keep commands thin; agents do the heavy lifting.

## Adding a hook

1. Write a script under `hooks/<event-name>/<script-name>.sh`:

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
   source "$SCRIPT_DIR/../lib/common.sh"
   somi::read_payload

   # Your guard logic here.
   # somi::block "reason" to deny.
   # jq -nc --arg c "..." '{additionalContext: $c}' to surface info back.

   exit 0
   ```

2. `chmod +x` it.
3. Wire it in `.claude/settings.json`:

   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Bash",
           "hooks": [
             {"type": "command", "command": "${SOMI_ROOT}/hooks/pre-tool/your-script.sh"}
           ]
         }
       ]
     }
   }
   ```

4. Validate: `scripts/validate.sh`.

Hooks should encode **non-negotiables** — things you want to be deterministic, not subject to model
judgment. For judgment-heavy work, write an agent or skill instead.

## Adding a project-specific override

In `rules/99-overrides.md` (which SOMI never touches):

```markdown
## Override: <short name>

**Rule overridden:** rules/<file>.md — "<rule>"
**Override:** <what changes>
**Reason:** <why this project needs it>
**Removal condition:** <what would make this override obsolete>
```

Or add a brand-new project convention that doesn't conflict with SOMI:

```markdown
## Convention: <short name>

<convention text>
```

## Adding a new install profile

`install/profiles/<name>.json`:

```json
{
  "name": "<name>",
  "description": "What this profile is for, and who should pick it.",
  "components": [
    "rules",
    "claudemd",
    "agents/<specific>.md",
    "commands",
    "..."
  ]
}
```

Then update [`docs/INSTALL.md`](./INSTALL.md) with the profile description.

## Versioning your extensions

If you're extending SOMI for your team, treat your extensions like the upstream repo: SemVer, change
log, validate-on-CI. See [VERSIONING.md](./VERSIONING.md) for the policy SOMI itself follows.

## Contributing back

If your extension is generic enough to help other teams, consider upstreaming it:

1. Open an issue on the SOMI repo describing the gap and the proposed addition.
2. Submit a PR with the new file, doc updates, profile updates, and validator passing.
3. SOMI maintainers review against the same quality bar as core SOMI components.

## What to avoid

- **Don't fork the agent system prompts unless you have to.** Compose, override, or wrap them
  instead. Forks drift.
- **Don't put feature-specific logic in `rules/`**. Rules are universal. Project-specific guidance
  goes in `99-overrides.md` or in skills.
- **Don't add hooks for things that need judgment.** A hook can't reason. If you find yourself
  writing a hook with nuanced conditions, you probably want a rule or skill.
- **Don't add agents whose `description` overlaps with an existing agent.** Overlapping descriptions
  confuse the model's decision about which agent to invoke.
