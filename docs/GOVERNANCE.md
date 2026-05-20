# Governance

How a team adopts SOMI, keeps it updated safely, and contributes back without chaos.

## Adoption checklist for a new team

1. **Pick a steward.** One named human is responsible for installing SOMI, running updates, and
   triaging issues. Without this, no shared tooling survives contact with reality.
2. **Pick a scope and profile.** See [INSTALL.md](./INSTALL.md). Most teams: `project` scope,
   `standard` profile, vendored under each repo. Larger orgs may prefer marketplace-based plugin
   distribution.
3. **Pin to a tag.** Don't track `main`. Pin to the latest `vX.Y.Z` and update deliberately.
4. **Write your `99-overrides.md`** for project-specific conventions before the team uses SOMI for the
   first time. Empty is fine; the file's presence is the signal.
5. **Run a `/ship` on a small feature** as a calibration exercise. Tweak the override file based on
   what the team disagrees with.
6. **Add SOMI to your CI**: at minimum, run `scripts/validate.sh` against the install in case a
   teammate edits SOMI files locally.

## Update cadence

- **Patch releases**: adopt automatically (auto-update via `update.sh` in CI on a schedule, or
  manually whenever your steward feels like it).
- **Minor releases**: read the changelog, adopt within a week or two. Test against a low-stakes repo
  first if you maintain many.
- **Major releases**: schedule. Read the migration notes. Apply on a single repo, validate, then
  fan out.

Don't auto-update across MAJOR boundaries. SemVer says you might break.

## Local divergence policy

You will eventually want to do something SOMI doesn't natively support. Three escalating responses:

1. **Override locally** in `99-overrides.md`. No coordination needed.
2. **Add a local agent / command / skill** under your project's `.claude/`. SOMI will not touch it.
3. **Fork or vendor SOMI** if your team's needs diverge significantly. Mark your fork clearly; track
   upstream tags so you can periodically merge.

Try (1) → (2) → (3) in order. (3) is expensive — only do it when you've outgrown (2).

## Contributing back

If your local change is generic enough to help other teams, open an issue on the SOMI repo:

- Title: clear and specific.
- Description: the gap, the proposed addition, the alternative considered, the trade-off.
- Optionally: a PR with the change, doc updates, profile updates, and validator passing.

The SOMI maintainers will review against the same quality bar as core SOMI: would this make sense
to teams who haven't seen your codebase? Is it general, or genuinely project-specific?

## Issue triage

Teams reporting bugs / proposing changes should provide:

- **SOMI version** (`cat .claude/.somi/install.json`).
- **Scope and profile**.
- **Reproduction**: the command that triggered the issue, what was expected, what happened.
- **Relevant excerpts** of any artifact files (with secrets redacted).

The audit log (`.claude/audit.log`) is often useful for bug reports — it shows exactly what tools
SOMI attempted.

## Security

SOMI hooks block dangerous operations by default, but they are **not** a security boundary. They are
a developer-experience guardrail. Real security boundaries are:

- The OS user Claude Code runs as.
- The file permissions on the workspace.
- The credentials available in the environment (which should be minimum needed).
- Your CI/PR review process (SOMI workflows are an *input* to PR review, not a replacement).

If you discover a vulnerability in SOMI itself (a hook can be bypassed, a script can be tricked into
modifying the wrong path), report it privately to the SOMI maintainers per the security policy in
the repo before disclosing publicly.

## Rollout pattern for a large org

If you maintain dozens or hundreds of repos:

1. **Pilot** on 3–5 representative repos for two sprints. Different stacks; different teams.
2. **Collect overrides** the pilot teams wrote. If multiple teams independently overrode the same
   SOMI default, propose changing the upstream default.
3. **Wave 1**: 20–30% of repos. Monitor `audit.log` patterns. Look for "agent kept hitting this hook"
   signals.
4. **Wave 2**: remaining repos.
5. **Establish a rotation**: monthly review of SOMI changelog → coordinated update.

## Anti-patterns

- **Each team rolls their own ruleset.** Defeats the point of shared tooling. If you must customise,
  customise via `99-overrides.md` so the customisation is visible and removable.
- **Pin to `main`.** You will be surprised. Tag, please.
- **Sneak changes into a fork without merging upstream.** Forks rot; the longer you delay merging the
  more painful it gets.
- **Disable hooks because they're annoying.** If a hook is wrong, fix it upstream (or override it
  locally with a removal condition). Don't just silence guardrails.
- **Treat SOMI workflows as a replacement for human review.** SOMI produces artifacts that *aid*
  review; humans still merge code.

## When to stop using SOMI

If your team has fundamentally different ways of working (e.g., research code, exploratory notebooks,
prototyping where planning would actively harm the work), drop SOMI. The system is opinionated; it's
not for every shape of work. Pick the tool that fits the work, not the other way around.
