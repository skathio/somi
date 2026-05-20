# sample-consumer — minimal project consuming somi-ai

This directory shows what a project looks like **after** running
`scripts/install.sh --scope project --profile standard --target .` against it.

It's a layout reference, not a runnable project — there's no application code here, just the files
SOMI would have placed.

## What you should see in your own project after install

```
<your project>/
├── CLAUDE.md                              # composed from rules/CLAUDE.md
├── .claude/
│   ├── settings.json                      # SOMI hooks wired up (merged with yours if it existed)
│   ├── .somi/install.json                 # records scope / profile / version / install date
│   ├── rules/                             # composed rule set
│   ├── agents/                            # planner, coder, reviewer (+ profile additions)
│   ├── commands/                          # /plan, /code, /review (+ profile additions)
│   ├── skills/                            # standard profile installs core skills
│   ├── templates/                         # artifact templates
│   └── plugins/
│       └── somi-ai/
│           ├── .claude-plugin/plugin.json
│           └── hooks/                     # the hook scripts settings.json points at
```

## Things to notice

- **`CLAUDE.md` is at the project root**, not under `.claude/`. Claude Code automatically loads it as
  project-level instructions.
- **Hooks live under `.claude/plugins/somi-ai/hooks/`** (not under `.claude/hooks/`). That
  layout lets the same scripts work whether SOMI is installed vendored or as a plugin.
- **`settings.json` is the merge of your existing settings + SOMI hooks/permissions**. Your existing
  `permissions.allow` is preserved; SOMI hook entries are appended; SOMI deny rules are added
  (union-merge).
- **`install.json` records the install state** so `scripts/update.sh` can re-install with the same
  scope and profile when you pull a new tag.

## What stays *yours* after install

- `CLAUDE.md` — SOMI will not overwrite a hand-edited `CLAUDE.md` without `--force`. If you want to
  add project-specific instructions, put them in [`rules/99-overrides.md`](../../rules/99-overrides.md)
  (which SOMI will not touch) or above the SOMI-composed section in your `CLAUDE.md`.
- All your existing `settings.json` keys outside of `hooks`, `permissions`, and `env`.
- Any `PLAN.md` / `REVIEW.md` / ADRs you produced — these are workflow artifacts, not SOMI internals.

## Re-running the install

```bash
~/path/to/somi-ai/scripts/install.sh \
  --scope project --profile standard --target .
```

Idempotent. Re-running upgrades in place.

## Uninstall

```bash
~/path/to/somi-ai/scripts/uninstall.sh --target .
```

Removes SOMI-managed paths and strips SOMI hook entries from `settings.json`. Leaves your `CLAUDE.md`,
`PLAN.md`, `REVIEW.md`, and `audit.log` alone.
