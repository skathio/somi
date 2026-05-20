# Versioning

SOMI follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`). The `VERSION` file at
the repo root is the source of truth. Git tags are `v<VERSION>` (e.g., `v0.1.0`).

## What counts as which kind of change

### MAJOR (X.0.0)

Bumped when there's a **breaking change** for consumers — i.e., re-running `install.sh` against an
existing install could surprise them. Examples:

- Removing an agent, command, hook, or skill that was in a previous release.
- Renaming a slash command or agent (the user's muscle memory breaks).
- Changing the install layout in a way that breaks `update.sh` from older versions.
- Changing the meaning of a frontmatter field in a way the agent's behavior depends on.
- Changing the `settings.json` schema in a non-additive way.
- Removing or hard-changing a rule that other rules / skills / agents reference.

### MINOR (0.X.0)

Bumped for **additive features**:

- Adding a new agent, command, skill, hook, template, or install profile.
- Adding new rules to existing rule files (without changing existing rules).
- Adding new fields to artifacts (templates) — provided existing artifacts still parse/render.
- Adding new install options that default to off / don't change existing behavior.

### PATCH (0.0.X)

Bumped for **bug fixes and clarifications**:

- Tightening or correcting wording in agents/skills/rules without changing intent.
- Fixing a hook regex that was over- or under-matching.
- Doc fixes.
- Tooling / scripts fixes that don't change the install surface.

## What is the public surface?

Treat these as the **public API** of SOMI:

- Slash command names and their argument shapes.
- Agent names, descriptions, and tool sets.
- Skill names and descriptions.
- Hook script paths and the contract (stdin payload shape, stdout decision shape).
- Install profile names and the components they include.
- `VERSION`, `CHANGELOG.md`, and the install script's CLI.
- The `settings.json` schema SOMI produces.

Anything else (internal helpers, comments, doc structure) is internal.

## Pre-1.0 caveat

Until `1.0.0`, **MINOR bumps may include breaking changes** documented as such in `CHANGELOG.md`.
After `1.0.0`, the policy above applies strictly.

## Release process

1. **Land changes** on `main` with a clear `CHANGELOG.md` entry under `[Unreleased]`.
2. **Pick the version bump** per the rules above.
3. **Move `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`** and start a fresh `[Unreleased]` section.
4. **Update `VERSION`** to `X.Y.Z`.
5. **Update `.claude-plugin/plugin.json`** and `.claude-plugin/marketplace.json` versions to match.
6. **Commit**: `chore: release v<X.Y.Z>`.
7. **Tag**: `git tag -a v<X.Y.Z> -m "v<X.Y.Z>"` then `git push --tags`.
8. **Validate** the tag's tree passes `scripts/validate.sh` in CI.
9. **Publish a GitHub release** with the relevant `CHANGELOG.md` section as the body.

## Deprecation policy

When something is going to be removed in the next MAJOR:

1. Mark it deprecated in the file (e.g., add `**Deprecated:**` note at the top of an agent or skill).
2. Add a `[Deprecated]` section under `[Unreleased]` in `CHANGELOG.md`.
3. Keep it functional for **at least one MINOR release** before the MAJOR bump that removes it.
4. Provide a migration note in the MAJOR's release notes.

Don't surprise consumers. A user upgrading from `0.4.x` to `0.5.x` should see the deprecation; a user
going from `0.5.x` to `1.0.0` should see the removal.

## Migration notes template

For breaking changes in a MAJOR release, include a migration note in `CHANGELOG.md`:

```markdown
### Breaking changes
- **Renamed `/audit` to `/security-review`** for consistency with the other review commands.
  - **Migration**: replace any team docs, shortcuts, or aliases referencing `/audit` with
    `/security-review`. The old command will not be restored.
- **Removed `agents/audit.md`** (replaced by `agents/security-reviewer.md` in 0.5.0).
  - **Migration**: re-run `scripts/install.sh` to pick up the new agent. Custom prompts referencing
    `audit` should reference `security-reviewer`.
```

## Pinning a version downstream

Teams can pin to a specific tag:

```bash
git clone --branch v0.1.0 https://github.com/your-org/somi-ai.git /opt/somi-ai
```

`update.sh` will check out the latest tag by default; pin in your fork or your team's vendoring
setup if you want stability.

## Yanking a release

If a released version is broken:

1. Push a new patch release (`0.X.Y+1`) with the fix.
2. Update `CHANGELOG.md` for `0.X.Y` with a `**Yanked**` notice referencing the fix release.
3. Leave the tag in place (don't rewrite history); add a release-page note marking the version as
   yanked.

Never rewrite or force-push a published tag.
