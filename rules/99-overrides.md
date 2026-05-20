# 99 — Project overrides

**SOMI will never modify this file.** It is your project's escape hatch.

Use this file to:

- Override a default behavior from `00`–`50` (and **document why**).
- Add project-specific conventions on top of the global rules.
- Pin a list of "things that look wrong but are intentional in this codebase."
- Record decisions whose context lives in this repo and nowhere else.

## How overrides work

Rules in `99-overrides.md` **take precedence** over the numbered files above it, but **not** over a
project-level `CLAUDE.md` outside the SOMI install (the project's own root `CLAUDE.md` wins).

When you override a SOMI default, write the override in this shape:

```markdown
## Override: <short name>

**Rule overridden:** rules/20-clean-code.md — "default: no comment"
**Override:** We require a one-line comment at the top of every exported function in `pkg/protocol/`.
**Reason:** This package is the wire format. Comments are extracted into the docs site by `tools/extract-protocol-docs`.
**Removal condition:** If the doc extractor is replaced with godoc-style parsing.
```

Each override has:
- **Rule overridden** — exact pointer to the SOMI rule.
- **Override** — what changes.
- **Reason** — why this project needs it (history, tooling, regulatory, etc.).
- **Removal condition** — what would make this override obsolete. If you can't state one, the override
  is probably indefinite — make that explicit.

## Project-specific additions

You can also add net-new rules here that don't conflict with SOMI, just shape behavior for this project:

```markdown
## Convention: HTTP error format

All HTTP handlers must respond with the error envelope defined in `internal/httperr`. See `httperr/README.md`
for the schema. Do not invent ad-hoc error shapes.
```

---

## Starter content for this project

<!-- Add overrides and conventions below. Delete this placeholder when the file has real content. -->

_(no overrides yet)_
