# sample-consumer — minimal project consuming somi

This directory shows what a project **consuming** SoMi looks like. Install it with:

```text
/plugin marketplace add https://github.com/skathio/somi
/plugin install somi@somi
```

It's a layout reference, not a runnable project — there's no application code here. Note that SoMi
creates **only** `.somi/`; `CLAUDE.md` and `.claude/settings.json` are yours.

> **A marketplace install does not put the plugin in your project.** Claude Code copies plugin
> files into a **user-level cache** (`~/.claude/plugins/cache`), so your project directory does not
> contain SoMi's code at all. The `.claude/plugins/somi/` node below shows the **vendored** layout —
> a copy you place in the repo yourself — and is drawn here only to name the pieces.

## Layout reference (vendored install shown)

```
<your project>/
├── CLAUDE.md                              # YOURS — SoMi never creates or writes this
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
    ├── settings.json                      # yours; SoMi writes none of it. Claude Code merges the
    │                                      # plugin's hooks/hooks.json at runtime (a project-scope
    │                                      # install may add its own enabledPlugins entry)
    └── plugins/
        └── somi/
            ├── .claude-plugin/plugin.json
            ├── agents/                    # discovery-analyst, planner, coder, reviewer + support
            ├── commands/                  # /discover, /plan, /code, /review, /ship + support
            ├── skills/                    # market-research, requirements-engineering, OWASP, SOLID, ...
            ├── rules/                     # global ruleset (00-50 + the 99-overrides.md starter template)
            ├── templates/                 # context, spec, decisions, phase, progress, diary, review, ADR, DoD; R&D: RD-README, RESEARCH, BRD, SRS, FRD, SDD, TDD
            └── hooks/                     # guardrail scripts; wired via hooks/hooks.json
```

## Things to notice

- **`CLAUDE.md` is yours and is never generated.** Claude Code loads it as project-level
  instructions. SoMi's own ruleset does **not** arrive through it — the `UserPromptSubmit` hook
  injects a priority floor every turn plus the digest on signature-change turns, and the numbered
  rule files are on-demand via the `rules` skill. See
  [`docs/RULES.md`](../../docs/RULES.md#how-the-ruleset-reaches-your-session).
- **Hooks live inside the plugin install directory** and are referenced via `${CLAUDE_PLUGIN_ROOT}`
  in `hooks/hooks.json` (or `${SOMI_VENDOR_ROOT}` for a vendored copy), so they work regardless of
  where the plugin root resolves. (`${SOMI_ROOT}` was removed before 2.0.0 — if you see that
  name in a vendored `settings.json`, it is stale.)
- **`settings.json` stays yours — SoMi never writes it.** Claude Code merges the plugin's
  `hooks/hooks.json` at runtime, so hooks fire without any file surgery; see
  [`docs/INSTALL.md`](../../docs/INSTALL.md), which states you do not need to edit
  `.claude/settings.json`. (A *vendored* copy is the exception — there you merge the hooks block by
  hand, as this directory's own `.claude/settings.json` explains in its `_comment`.)
- **All SoMi-written runtime state lives under `.somi/`, never `.claude/`.** `audit.log`,
  `somi-state/` (loop resume, context-injection signature), and `rules/99-overrides.md` are all
  project-local and host-neutral — the same regardless of whether the consumer is Claude Code or
  GitHub Copilot. Only the plugin's own *installed code*
  (agents/commands/skills/rules/hooks) lives under the plugin's install root — the user-level cache
  for a marketplace install, `.claude/plugins/somi/` for a vendored copy.

## What stays yours after install

- `CLAUDE.md` — SoMi never writes it at all, so there is nothing to overwrite. Add
  project-specific instructions in `.somi/rules/99-overrides.md`, which SoMi never touches and which
  survives `/plugin update somi` (that path is consumer-relative: it exists in your project, not in
  this example directory), or directly in your `CLAUDE.md`.
- Your `settings.json` in full — SoMi writes none of it.
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
