# sample-consumer — minimal project consuming somi

This directory shows what a project looks like **after** installing SoMi via the Claude Code
plugin marketplace:

```text
/plugin marketplace add https://github.com/skathio/somi
/plugin install somi@somi
```

It's a layout reference, not a runnable project — there's no application code here, just the
files SoMi's plugin runtime places.

## What you should see in your own project after install

```
<your project>/
├── CLAUDE.md                              # composed from rules/CLAUDE.md
├── .somi/                                 # workflow artifacts + project-local SoMi state
│   ├── README.md
│   ├── rules/
│   │   └── 99-overrides.md                # your project escape hatch (created by /adopt or by hand)
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
│   ├── reviews/
│   │   └── <slug>/                        # reviews keyed by work-item slug
│   ├── somi-state/                        # runtime state (loop resume, context-injection signature); gitignored
│   └── audit.log                          # append-only tool-call log; gitignored
└── .claude/
    ├── settings.json                      # SoMi hooks wired up (merged with yours if it existed)
    └── plugins/
        └── somi/
            ├── .claude-plugin/plugin.json
            ├── agents/                    # discovery-analyst, planner, coder, reviewer + support
            ├── commands/                  # /discover, /plan, /code, /review, /ship + support
            ├── skills/                    # market-research, requirements-engineering, OWASP, SOLID, ...
            ├── rules/                     # global ruleset (00-50 + the 99-overrides.md starter template)
            ├── templates/                 # context, spec, decisions, phase, progress, diary, review, ADR, DoD; R&D: RD-README, RESEARCH, BRD, SRS, FRD, SDD, TDD
            └── hooks/                     # guardrail scripts settings.json points at
```

## Things to notice

- **`CLAUDE.md` is at the project root**, not under `.claude/`. Claude Code automatically loads it
  as project-level instructions.
- **Hooks live under `.claude/plugins/somi/hooks/`** and are referenced via `${SOMI_ROOT}` in
  `settings.json` so they work regardless of where the plugin root resolves.
- **`settings.json` is the merge of your existing settings + SoMi hooks/permissions**. Your
  existing `permissions.allow` is preserved; SoMi hook entries are appended; SoMi deny rules are
  added (union-merge).
- **All SoMi-written runtime state lives under `.somi/`, never `.claude/`.** `audit.log`,
  `somi-state/` (loop resume, context-injection signature), and `rules/99-overrides.md` are all
  project-local and host-neutral — the same regardless of whether the consumer is Claude Code or
  GitHub Copilot. Only the plugin's own *installed code* (agents/commands/skills/rules/hooks) lives
  under `.claude/plugins/somi/`.

## What stays yours after install

- `CLAUDE.md` — the plugin runtime does not overwrite a hand-edited `CLAUDE.md`. Add
  project-specific instructions in [`.somi/rules/99-overrides.md`](.somi/rules/99-overrides.md)
  (which SoMi never touches, and which survives `/plugin update somi`) or directly in your
  `CLAUDE.md`.
- All your existing `settings.json` keys outside of `hooks`, `permissions`, and `env`.
- Everything under `.somi/` — workflow artifacts and SoMi's own project-local state. Work items
  persist indefinitely; only you delete from there.

## Updating

```text
/plugin update somi
```

## Uninstalling

```text
/plugin uninstall somi
```

Removes the plugin. Leaves your `CLAUDE.md` and everything under `.somi/` (including `audit.log`
and `rules/99-overrides.md`) alone.
