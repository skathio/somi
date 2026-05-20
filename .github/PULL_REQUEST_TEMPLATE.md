# Pull request

## Summary

<One paragraph: what this PR changes, and what kind of change it is (rule / agent / skill / hook /
command / docs / tooling).>

## Type of change

- [ ] **MAJOR** — breaking change (rename, removal, schema change)
- [ ] **MINOR** — additive (new agent / skill / hook / command / profile)
- [ ] **PATCH** — fix or clarification (no surface change)
- [ ] **DOCS** — documentation only

Per [VERSIONING.md](../docs/VERSIONING.md). The right `VERSION` bump and `CHANGELOG.md` entry depend
on this choice.

## Checklist

- [ ] `scripts/validate.sh` passes locally.
- [ ] All new/changed agents, skills, and commands have proper frontmatter.
- [ ] All new/changed hook scripts are executable and have `#!/usr/bin/env bash` + `set -euo pipefail`.
- [ ] If components were added: install profiles updated.
- [ ] `CHANGELOG.md` updated under `[Unreleased]`.
- [ ] Docs updated where the change is user-visible.
- [ ] For breaking changes: migration notes included.

## Test plan

- [ ] Ran `./scripts/install.sh --scope project --profile standard --target /tmp/test-target` and
      verified the install succeeded.
- [ ] (If hook/command/agent change) Manually invoked the affected component in a real Claude Code
      session and observed expected behavior.

## Related issues

Closes #<...>
