# Governance

How a team adopts SoMi, keeps it updated safely, and contributes back without chaos.

## Adoption checklist for a new team

1. **Pick a steward.** One named human is responsible for installing SoMi, running updates, and
   triaging issues. Without this, no shared tooling survives contact with reality.
2. **Pick a distribution path.** See [INSTALL.md](./INSTALL.md). Most teams: Claude Code plugin via
   marketplace. Orgs that want a locked version can pin via `/plugin pin somi <version>` or
   host their own marketplace manifest.
3. **Pin to a tag.** Don't track `main`. Pin to the latest `vX.Y.Z` and update deliberately.
4. **Write your `99-overrides.md`** for project-specific conventions before the team uses SoMi for the
   first time. Empty is fine; the file's presence is the signal. If the team wants a standalone
   shipping standard on top of each work item's `spec.md` §12, instantiate
   [`templates/DOD.md.tmpl`](../templates/DOD.md.tmpl) as a team-level checklist. Loop caps and
   hook policy (dep-install allowlist, lockfile edits) can be committed per project in
   `.somi/config.json` — see [USAGE.md](./USAGE.md#project-configuration-somiconfigjson).
5. **Run a `/ship` on a small feature** as a calibration exercise. Tweak the override file based on
   what the team disagrees with.
6. **Add SoMi to your CI**: validate the plugin install is intact and hooks still fire on a
   smoke-test prompt.

## Update cadence

- **Patch releases**: adopt automatically (run `/plugin update somi` on a schedule, or
  manually whenever your steward feels like it).
- **Minor releases**: read the changelog, adopt within a week or two. Test against a low-stakes repo
  first if you maintain many.
- **Major releases**: schedule. Read the migration notes. Apply on a single repo, validate, then
  fan out.

Don't auto-update across MAJOR boundaries. SemVer says you might break.

## Local divergence policy

You will eventually want to do something SoMi doesn't natively support. Three escalating responses:

1. **Override locally** in `99-overrides.md`. No coordination needed.
2. **Add a local agent / command / skill** under your project's `.claude/`. SoMi will not touch it.
3. **Fork or vendor SoMi** if your team's needs diverge significantly. Mark your fork clearly; track
   upstream tags so you can periodically merge.

Try (1) → (2) → (3) in order. (3) is expensive — only do it when you've outgrown (2).

## Contributing back

If your local change is generic enough to help other teams, open an issue on the SoMi repo:

- Title: clear and specific.
- Description: the gap, the proposed addition, the alternative considered, the trade-off.
- Optionally: a PR with the change, doc updates, profile updates, and validator passing.

The SoMi maintainers will review against the same quality bar as core SoMi: would this make sense
to teams who haven't seen your codebase? Is it general, or genuinely project-specific?

## Issue triage

Teams reporting bugs / proposing changes should provide:

- **SoMi version** (`cat .claude/.somi/install.json`).
- **Scope and profile**.
- **Reproduction**: the command that triggered the issue, what was expected, what happened.
- **Relevant excerpts** of any artifact files (with secrets redacted).

The audit log (`.claude/audit.log`) is often useful for bug reports — it shows exactly what tools
SoMi attempted.

## Security

SoMi hooks block dangerous operations by default, but they are **not** a security boundary. They are
a developer-experience guardrail. Real security boundaries are:

- The OS user Claude Code runs as.
- The file permissions on the workspace.
- The credentials available in the environment (which should be minimum needed).
- Your CI/PR review process (SoMi workflows are an *input* to PR review, not a replacement).

If you discover a vulnerability in SoMi itself (a hook can be bypassed, a script can be tricked into
modifying the wrong path), report it privately to the SoMi maintainers per the security policy in
the repo before disclosing publicly.

## Rollout pattern for a large org

If you maintain dozens or hundreds of repos:

1. **Pilot** on 3–5 representative repos for two sprints. Different stacks; different teams.
2. **Collect overrides** the pilot teams wrote. If multiple teams independently overrode the same
   SoMi default, propose changing the upstream default.
3. **Wave 1**: 20–30% of repos. Monitor `audit.log` patterns. Look for "agent kept hitting this hook"
   signals.
4. **Wave 2**: remaining repos.
5. **Establish a rotation**: monthly review of SoMi changelog → coordinated update.

## Anti-patterns

- **Each team rolls their own ruleset.** Defeats the point of shared tooling. If you must customise,
  customise via `99-overrides.md` so the customisation is visible and removable.
- **Pin to `main`.** You will be surprised. Tag, please.
- **Sneak changes into a fork without merging upstream.** Forks rot; the longer you delay merging the
  more painful it gets.
- **Disable hooks because they're annoying.** If a hook is wrong, fix it upstream (or override it
  locally with a removal condition). Don't just silence guardrails.
- **Treat SoMi workflows as a replacement for human review.** SoMi produces artifacts that *aid*
  review; humans still merge code.

## When to stop using SoMi

If your team has fundamentally different ways of working (e.g., research code, exploratory notebooks,
prototyping where planning would actively harm the work), drop SoMi. The system is opinionated; it's
not for every shape of work. Pick the tool that fits the work, not the other way around.
