---
name: rules
description: Use to load the full text of a numbered rules file (00-priorities, 10-solid, 20-clean-code, 30-security-owasp, 40-engineering-practices, 50-collaboration) once your turn has entered that file's domain, or to find where a project's local rule overrides live. The always-on digest (injected on every gated turn by the UserPromptSubmit hook) is the compressed form of these six files; this skill is the full detail behind each digest bullet.
---

# Rules — full detail on demand

[`hooks/user-prompt-submit/inject-workflow-context.mjs`](../../hooks/user-prompt-submit/inject-workflow-context.mjs)
injects an always-on digest into every consuming Claude Code session: a small always-on floor every
turn, plus the full eleven-bullet digest whenever the turn is the first of a session or work-item
state changed since the last one. That digest is the compressed form of the ruleset — enough to act
correctly on the common path without loading all six numbered files. This skill is the
progressive-disclosure half of that split: load the specific file below once your current turn
actually enters its domain, rather than carrying all six always.

## The six always-in-force files

| File | Load when |
|------|-----------|
| [`rules/00-priorities.md`](../../rules/00-priorities.md) | Start of any workflow — priorities, uncertainty handling, escalation. |
| [`rules/10-solid.md`](../../rules/10-solid.md) | Designing a module, naming a class, splitting or merging responsibilities. |
| [`rules/20-clean-code.md`](../../rules/20-clean-code.md) | Naming, function structure, comments, diff hygiene. |
| [`rules/30-security-owasp.md`](../../rules/30-security-owasp.md) | Touching a trust boundary or sink — auth, crypto, input validation, secrets. |
| [`rules/40-engineering-practices.md`](../../rules/40-engineering-practices.md) | Shaping tests, observability, or dependencies. |
| [`rules/50-collaboration.md`](../../rules/50-collaboration.md) | Start of any workflow — working with humans, handoffs between agents. |

Read `00` and `50` in full at the start of any workflow regardless of domain — they govern *how* you
work, not a specific domain. Read `10`/`20`/`30`/`40` only once you enter their domain; the digest
line is enough until then. Don't load one speculatively — each costs context, and the model performs
worse when loaded knowledge doesn't match the task at hand.

## The project's own overrides — a different artifact

[`rules/99-overrides.md`](../../rules/99-overrides.md) in this repo is a **template**, not a live
rule file — it is never itself in force and is not one of the six files above. A consuming project's
actual, active overrides live at **`.somi/rules/99-overrides.md`** inside that project (never
`.claude/` or `.github/`, so the path stays neutral across hosts and survives plugin updates). Always
check that path for a project's overrides — they win over everything else in this ruleset, including
every file listed above.

## When *not* to load a file here

If the digest bullet already answers the question in front of you, don't load the full file just to
confirm it — that's the digest doing its job. Load the full file when the digest line isn't enough:
a genuine judgment call within the domain, an edge case the one-liner doesn't cover, or you're about
to write something the digest only summarizes (e.g. actually touching a trust boundary, not just
being aware `30` exists).
