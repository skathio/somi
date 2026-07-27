# sample-consumer — Project instructions

This file is the **project's** `CLAUDE.md` — **yours, hand-written**. SoMi does not generate it and
never writes to it. It holds your project's own instructions; SoMi's ruleset arrives separately (see
below).

---

## SoMi's ruleset — you do not need to wire this up

**Nothing in this section is required.** On Claude Code, SoMi's `UserPromptSubmit` hook injects a
priority floor (a header plus four bullets) on every turn, plus the fuller digest whenever the
work-item signature changes; the numbered files are available on demand via the `rules` skill.
On GitHub Copilot, `extension.json`'s `"rules"` key handles it. See
[`docs/RULES.md`](../../docs/RULES.md#how-the-ruleset-reaches-your-session) (repo-relative — that
link will not resolve once you copy this file into your own project).

If you want SoMi's digest pinned into *this* file's context regardless — so it is present on every
turn rather than only on signature-change turns — use an **`@import`**. A markdown link is inert;
Claude Code will not follow it.

> **This imports `rules/CLAUDE.md` only — roughly 200 of the ruleset's ~700 lines.** That file
> references `00`–`50` with markdown links, and `@` expansion does not follow those, so the
> numbered files (~460 lines) do **not** come with it. What you get is the digest plus the
> composition index — close to what the hook already injects. For the numbered files, use the
> `rules` skill.

**Find your plugin root first.** A marketplace install copies SoMi into a user-level cache
(`~/.claude/plugins/cache`), *not* into your project; a vendored copy is wherever you put it. Note
that `/plugin` lists installed plugins and their components but does **not** show a filesystem
path, so it cannot answer this. Once you know the root, add a line of this shape, unindented and
**not** inside a code fence:

@your/plugin/root/rules/CLAUDE.md

> The line above is a **placeholder** — that path does not exist, so as written it is a no-op.
> Replace `your/plugin/root` with your real root before it does anything.

> **Three silent-failure modes to avoid.** (1) **Import parsing skips fenced code blocks and code
> spans** — a `@path` inside triple-backticks or `` ` `` is deliberately *not* imported, so the line
> above must be bare. (2) An `@import` pointing at a nonexistent path fails without warning.
> (3) An import resolving **outside your project** — which a marketplace install always is, since
> the plugin lives in a home-directory cache — triggers a one-time approval dialog; **if you decline
> it, the imports stay disabled and the dialog never reappears.** After adding the line, confirm the
> ruleset is actually in context rather than assuming it.

> If you want to override a SOMI default, edit
> `.somi/rules/99-overrides.md` (consumer-relative — that path exists in your project, not in this
> example directory) — SOMI will never touch that file.
> This lives under `.somi/`, not `.claude/` or `.github/`, so it stays the same regardless of
> which host (Claude Code, GitHub Copilot) is consuming SoMi.

---

## Project-specific instructions

<!-- Add your project's conventions, idioms, and gotchas below. SOMI rules already cover SOLID,
     clean code, OWASP, and engineering practices — focus on what's unique about THIS project. -->

### Stack

- Language: TypeScript (Node 20).
- Framework: Fastify.
- DB: Postgres via Prisma.
- Tests: Vitest + Testcontainers for DB integration.

### Project conventions

- HTTP error envelope is defined in `src/lib/httperr.ts` — use it everywhere.
- Domain code lives in `src/domain/`; it must not import from `src/infra/`.
- All migrations are reversible; the down migration is part of the same PR as the up.
- Logs are JSON via `pino`; never `console.log` in committed code.

### What goes in PRs

- Tests (no exceptions for non-trivial logic).
- Updated `docs/` if behavior or interfaces changed.
- A short summary referencing the plan iteration if there was one.
