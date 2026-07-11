# Versioning

SoMi follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`). Releases are
**explicit and dispatch-driven**: a maintainer triggers a release by running `publish.yml`'s
`workflow_dispatch` with a `bump` choice (`patch`/`minor`/`major`) — see Release process below.
Before cutting a release, the maintainer **hand-updates the in-repo version files to the target
version and commits them** (see the **Version files** section), so the repo's declared version
matches what is published rather than lagging behind it — nothing in the pipeline writes a version
back into the repo. The **published git tags (`v<VERSION>`) and the npm registry remain the record
of what was actually released**; cross-check the
[npm page](https://www.npmjs.com/package/@skathio/somi) or
[Releases](https://github.com/skathio/somi/releases).

## What counts as which kind of change

### MAJOR (X.0.0)

Bumped when there's a **breaking change** for consumers — i.e., upgrading the plugin version could
surprise them. Examples:

- Removing an agent, command, hook, or skill that was in a previous release.
- Renaming a slash command or agent (the user's muscle memory breaks).
- Changing the plugin directory structure in a way that breaks `/plugin update` from older versions.
- Changing the meaning of a frontmatter field in a way the agent's behavior depends on.
- Changing the `settings.json` schema in a non-additive way.
- Removing or hard-changing a rule that other rules / skills / agents reference.

### MINOR (0.X.0)

Bumped for **additive features**:

- Adding a new agent, command, skill, hook, or template.
- Adding new rules to existing rule files (without changing existing rules).
- Adding new fields to artifacts (templates) — provided existing artifacts still parse/render.
- Adding new extension commands or VS Code chat participants that default to opt-in.

### PATCH (0.0.X)

Bumped for **bug fixes and clarifications**:

- Tightening or correcting wording in agents/skills/rules without changing intent.
- Fixing a hook regex that was over- or under-matching.
- Doc fixes.
- CI / tooling fixes that don't change the plugin surface.

## What is the public surface?

Treat these as the **public API** of SoMi:

- Slash command names and their argument shapes.
- Agent names, descriptions, and tool sets.
- Skill names and descriptions.
- Hook script paths and the contract (stdin payload shape, stdout decision shape).
- `VERSION`, `CHANGELOG.md`, and the plugin manifest schema.
- The `settings.json` schema SoMi produces.

Anything else (internal helpers, comments, doc structure) is internal.

## Pre-1.0 caveat

Until `1.0.0`, **MINOR bumps may include breaking changes** documented as such in `CHANGELOG.md`.
After `1.0.0`, the policy above applies strictly.

## Version files

The version is carried in several files, and they are **hand-maintained to match each release** —
nothing in the pipeline writes them back (see Release process). Bump **all** of them together, to
the same value, in the release-prep change:

- `VERSION`
- `package.json` and `package-lock.json` (both the root `version` and `packages[""].version`)
- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
- `.copilot-extension/extension.json` and `.copilot-extension/marketplace.json`

Then move the `CHANGELOG.md` `[Unreleased]` entry under a dated `## [X.Y.Z] — YYYY-MM-DD` heading
(add migration notes for a MAJOR — see the template below). `npm test` validates that every
manifest is still valid JSON after the bump.

## Release process

Releases are **explicit and dispatch-driven** (adopting hashira's v2 contract: the
`version-resolver` composite action feeding the `npm-release` composite action). There is **no**
automatic inference from commit messages anywhere in this pipeline — a maintainer always
explicitly chooses the bump. Tagging and publishing to npm are done by the workflow, **not** by
hand; the one thing you **do** update by hand is the set of version files above (step 1 below).

1. **Land changes** on `main` via PR as usual, and — as part of the release-prep change —
   **hand-bump every version file** (see the **Version files** section) to the target version and
   move the `CHANGELOG.md` `[Unreleased]` entry under a dated `[X.Y.Z]` heading.
   [Conventional Commits](https://www.conventionalcommits.org/) style is still a reasonable
   convention for commit hygiene, but **no commit message is parsed to decide whether or how to
   release** — a bare push to `main` only runs the `ci` gate (`scripts/validate.sh` +
   `npm publish --dry-run`); it never triggers a publish.
2. **To cut a release**, a maintainer runs `publish.yml` via `workflow_dispatch` and sets the
   `bump` input to one of `patch`, `minor`, or `major`:
   - `patch`/`minor` increment off the latest stable git tag.
   - `major` produces the next major with minor/patch reset to `0`.
   - **First release only** (no prior stable tag): also set `seed_version` (e.g. `0.0.0`) — the
     chosen `bump` applies on top of the seed, it is not published literally.
3. The `version` job resolves the next version from the repo's tag history, surfaces it in the
   run summary **before** anything is built, and packs a tarball with that version stamped in
   (an isolated copy — never the checked-out tree; see "no commit-back" below). Because both the
   hand-bump in step 1 and this resolver derive from the **same explicit `bump`**, the resolved
   version should equal the one you committed — pick the matching `bump` so they don't diverge.
4. The `publish` job (gated by the `production` Environment — one required approval) calls
   hashira's `npm-release` action with the resolved version and `auth: oidc`:
   - publishes the same-run tarball to npm via native OIDC trusted publishing (no long-lived
     token; `auth: oidc` fails loud on any OIDC failure rather than falling back to a secret —
     there is none configured),
   - pushes the `v<X.Y.Z>` git tag, and
   - creates the matching **GitHub Release** using GitHub's server-side `--generate-notes`
     (summarized from merged-PR titles/labels — expect different-looking notes than the old
     commit-message-driven generator produced, not necessarily worse, just a different source).
5. Leaving `bump` empty on a `workflow_dispatch` (or omitting it) runs only the `ci` gate — useful
   for a manual CI-only re-run that isn't cutting a release.

> The `publish` workflow does **not** bump `VERSION` / `package.json` back into the repo — it stamps
> the resolved version only into the isolated tarball it publishes. Keeping the in-repo version files
> current is therefore a **manual** step, done in the release-prep change (step 1 / the **Version
> files** section). The git tags + npm registry remain the record of what was actually released; the
> hand-committed files should match them, not lag.

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
  - **Migration**: run `/plugin update somi` to pick up the new agent. Custom prompts referencing
    `audit` should reference `security-reviewer`.
```

## Pinning a version downstream

Teams can pin to a specific tag:

```text
/plugin pin somi 0.1.0
```

Or pin to a specific tag in your org's marketplace manifest (`"version": "0.1.0"`) to control
which version teams receive.

## Yanking a release

If a released version is broken:

1. Push a new patch release (`0.X.Y+1`) with the fix.
2. Update `CHANGELOG.md` for `0.X.Y` with a `**Yanked**` notice referencing the fix release.
3. Leave the tag in place (don't rewrite history); add a release-page note marking the version as
   yanked.

Never rewrite or force-push a published tag.
