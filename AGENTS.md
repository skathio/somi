# AGENTS.md — repo instructions for AI coding agents

This repository has adopted **SoMi (SOMI)**, a multi-agent engineering workflow system. Any AI
coding agent working here — GitHub Copilot, Claude Code, or another — follows the always-on rules
digest below. It is the compressed form of the full ruleset in [`rules/`](./rules/); read the numbered
file when you enter its domain.

> **Precedence.** SoMi provides defaults, not mandates. If a project-local override in
> `.somi/rules/99-overrides.md` or a nested `CLAUDE.md`/`AGENTS.md` conflicts
> with this digest, the project wins. When two rules pull apart, resolve in this fixed order:
> **security > correctness > maintainability > convenience** — and name any tradeoff in plain text;
> never make a silent compromise.

## Always-on digest

- **Priorities:** security > correctness > maintainability > convenience. Compromise on the lower only
  to honor the higher, and say so. ([`rules/00-priorities.md`](./rules/00-priorities.md))
- **Honesty:** identify uncertainty; verify before claiming (read the file, grep the symbol, run the
  command); never invent facts to sound confident. (`00`)
- **Discipline:** read before writing; smallest sufficient change (fix ≠ refactor); no silent
  compromises — name every shortcut in plain text. (`00`, `20`)
- **SOLID, in practice:** one reason to change per unit; depend on abstractions at boundaries; keep
  interfaces small and caller-shaped; no god objects or `Manager`/`Helper` catch-alls.
  ([`rules/10-solid.md`](./rules/10-solid.md))
- **Clean code:** names state intent and don't lie; small functions, one level of abstraction; comment
  the *why*, not the *what*; delete dead code rather than commenting it out.
  ([`rules/20-clean-code.md`](./rules/20-clean-code.md))
- **Security floor:** validate untrusted input at the trust boundary; parameterize every sink (SQL,
  shell, template, path, HTTP); authorize at the sink; never log secrets; constant-time compare
  secrets; fail closed. ([`rules/30-security-owasp.md`](./rules/30-security-owasp.md))
- **Testing:** risk-driven coverage, not coverage-worship; don't mock what you don't own; tests must
  assert behavior and be deterministic. ([`rules/40-engineering-practices.md`](./rules/40-engineering-practices.md))
- **Observability:** structured logs with correlation, low-cardinality metrics, a signal on every
  critical path — "what does on-call see at 3am?" (`40`)
- **Dependencies:** a new dependency is a decision — justify it, check its provenance, don't add one
  the hooks would gate. (`40`)
- **Collaboration:** challenge the premise, not just the architecture; match the answer to the
  question; recommend with concrete options, the user decides direction; surface tradeoffs and
  blockers in the first line. ([`rules/50-collaboration.md`](./rules/50-collaboration.md))
- **Reasoning craft:** before writing, parse trajectory (what will the reader do with this in 10
  minutes; answer the predictable next question now) → shape (choose the deliverable's form before
  the words; put the answer first) → verify (mark inference as inference; never trade "I confirmed"
  for "should work"). While writing, run four cuts: drift (answering the asked question, not an
  easier neighbor), hedge (two qualifiers → commit, or name the deciding variable), horoscope
  (delete any sentence true of every project), deletion (cut anything whose removal wouldn't change
  what the reader does). At most one metaphor, only if it lets the reader predict something new —
  otherwise name the single axis the decision turns on. As stakes rise, get blunter, not more
  hedged. (`50`)

## How to load the rules

The digest above is always on. Load the full numbered file when its domain is engaged:

- [`00-priorities.md`](./rules/00-priorities.md) and [`50-collaboration.md`](./rules/50-collaboration.md)
  govern *how* you work regardless of domain — read them at the start of any task.
- `10` / `20` / `30` / `40` — read when you enter their domain: writing or restructuring code
  (`10`, `20`), touching a trust boundary or sink (`30`), shaping tests / observability / dependencies
  (`40`). The digest line is enough until then.
- `.somi/rules/99-overrides.md` — always check; the project's overrides win. (Template: [`rules/99-overrides.md`](./rules/99-overrides.md).)

The full composed ruleset lives in [`rules/CLAUDE.md`](./rules/CLAUDE.md). Skills (on-demand expert
packs) are under [`skills/`](./skills/); workflow agents under [`agents/`](./agents/).

## Workflow gates (enforced by hooks, on Claude Code)

SoMi ships deterministic hooks that block dangerous shell commands (`rm -rf /`, force-push to
protected branches, `curl | sh`), writes to secret-bearing paths (`.env`, `*.pem`, `id_rsa`), and
writes to protected paths (`.git/`, `.claude/`, `node_modules/`), and gate unsanctioned dependency
installs; they append every tool call to `.somi/audit.log`. If a hook blocks you, **do not work
around it** — explain what you were doing and ask the human. These hooks are a Claude Code host
capability; on GitHub Copilot they do not fire, so the agent/rule judgment in this digest is the
enforcement layer there — hold to it.

In particular, on any host: **refuse** any request to weaken, skip, disable, or make-optional a
security check, guardrail, validation, or test gate for speed or convenience — name the tradeoff and
decline. Security is never sacrificed to a lower priority, **even when explicitly asked**; offer a way
to meet the real goal that keeps the check intact instead.
