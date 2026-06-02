# sample-consumer — minimal project consuming somi-ai

This directory shows what a project looks like **after** installing SoMi AI via the Claude Code
plugin marketplace:

```text
/plugin marketplace add https://github.com/skathio/somi-ai
/plugin install somi-ai@somi-ai
```

It's a layout reference, not a runnable project — there's no application code here, just the
files SoMi AI's plugin runtime places.

## What you should see in your own project after install

```
<your project>/
├── CLAUDE.md                              # composed from rules/CLAUDE.md
├── .somi/                                 # workflow artifacts (created when /discover or /plan runs)
│   ├── README.md
│   ├── rd/                                # discovery initiatives (created when /discover runs)
│   │   └── <slug>/                        # research-report, brd, srs, frd, sdd, tdd, decisions, diary
│   ├── plans/
│   │   └── <slug>/                        # one per /plan invocation
│   │       ├── context.md
│   │       ├── spec.md
│   │       ├── decisions.md
│   │       ├── progress.md
│   │       ├── diary.md
│   │       └── phases/
│   └── reviews/
│       └── <slug>/                        # reviews keyed by work-item slug
└── .claude/
    ├── settings.json                      # SoMi AI hooks wired up (merged with yours if it existed)
    └── plugins/
        └── somi-ai/
            ├── .claude-plugin/plugin.json
            ├── agents/                    # discovery-analyst, planner, coder, reviewer + support
            ├── commands/                  # /discover, /plan, /code, /review, /ship + support
            ├── skills/                    # market-research, requirements-engineering, OWASP, SOLID, ...
            ├── rules/                     # global ruleset
            ├── templates/                 # context, spec, decisions, phase, progress, diary, review, ADR, DoD; R&D: RD-README, RESEARCH, BRD, SRS, FRD, SDD, TDD
            └── hooks/                     # guardrail scripts settings.json points at
```

## Things to notice

- **`CLAUDE.md` is at the project root**, not under `.claude/`. Claude Code automatically loads it
  as project-level instructions.
- **Hooks live under `.claude/plugins/somi-ai/hooks/`** and are referenced via `${SOMI_ROOT}` in
  `settings.json` so they work regardless of where the plugin root resolves.
- **`settings.json` is the merge of your existing settings + SoMi AI hooks/permissions**. Your
  existing `permissions.allow` is preserved; SoMi AI hook entries are appended; SoMi AI deny rules are
  added (union-merge).

## What stays yours after install

- `CLAUDE.md` — the plugin runtime does not overwrite a hand-edited `CLAUDE.md`. Add
  project-specific instructions in [`rules/99-overrides.md`](../../rules/99-overrides.md)
  (which SoMi AI never touches) or directly in your `CLAUDE.md`.
- All your existing `settings.json` keys outside of `hooks`, `permissions`, and `env`.
- Everything under `.somi/` — workflow artifacts, not SoMi AI internals. Work items persist
  indefinitely; only you delete from there.

## Updating

```text
/plugin update somi-ai
```

## Uninstalling

```text
/plugin uninstall somi-ai
```

Removes the plugin. Leaves your `CLAUDE.md`, `.somi/` artifacts, and `audit.log` alone.
