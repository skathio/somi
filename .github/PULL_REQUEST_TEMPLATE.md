# Pull request

## Summary

<One paragraph: what this PR changes, and what kind of change it is (rule / agent / skill / hook /
command / docs / tooling).>

## Type of change

- [ ] **MAJOR** — breaking change (rename, removal, schema change)
- [ ] **MINOR** — additive (new agent / skill / hook / command)
- [ ] **PATCH** — fix or clarification (no surface change)
- [ ] **DOCS** — documentation only

Per [VERSIONING.md](../docs/VERSIONING.md). The right `VERSION` bump and `CHANGELOG.md` entry depend
on this choice.

## Checklist

- [ ] CI passes (frontmatter, TypeScript compile, ShellCheck).
- [ ] All new/changed agents, skills, and commands have proper frontmatter.
- [ ] All new/changed hook scripts are executable and have `#!/usr/bin/env bash` + `set -euo pipefail`.
- [ ] `CHANGELOG.md` updated under `[Unreleased]`.
- [ ] Docs updated where the change is user-visible.
- [ ] For breaking changes: migration notes included.

## Test plan

- [ ] (If hook/command/agent change) Manually invoked the affected component in a real Claude Code
      session and observed expected behavior.
- [ ] (If Copilot extension change) Tested `@somi /<command>` in GitHub Copilot chat.

## Related issues

Closes #<...>
