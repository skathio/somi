# 40 — Engineering practices

Testing, observability, dependencies, delivery. The mechanics that turn "code works on my machine" into
"code works in production for years."

## Testing

- **Tests are part of the change**, not a follow-up PR. If you can't write a test, say why.
- **Test what's risky, not what's obvious.** A unit test for `add(1, 2) == 3` is theatre.
- **Pick the right level**:
  - **Unit** — pure logic, branching, data shaping.
  - **Integration** — code that crosses a process or data boundary.
  - **End-to-end** — the user-visible journey through several components.
  Most projects need a healthy unit base and a handful of e2e; integration fills the gap.
- **Don't mock what you don't own.** Mocking a third-party SDK and then calling it "tested" is wishful.
  Prefer fakes you write that match the contract, or hit the real thing in integration.
- **Tests document intent.** Test names should describe the behavior in plain English.
- **Flaky tests are bugs.** Quarantine and fix, never paper over with retries.
- **No coverage worship.** 100% coverage of trivial paths is not safety. Coverage of the gnarly paths is.

## Observability

- **Logs are structured.** JSON or key-value, never `printf` soup.
- **Three signals**: logs (what happened), metrics (how often/fast), traces (causality across services).
- **Correlate**: every request gets an ID; every log line carries it.
- **Cardinality discipline.** Don't put user IDs in metric labels.
- **Alert on symptoms, page on impact.** Disk-full as a symptom; user-facing error rate as the page.
- **Every error path is a log path.** "Caught and ignored" is a bug.

## Dependencies

- **Adding a dep is a decision.** Each new dependency adds attack surface, transitive risk, and
  long-term maintenance. Justify it.
- **Pin and lock.** Use the lockfile. Reproducible builds matter.
- **Direct over transitive** for security-sensitive deps. Don't rely on a top-level dep to keep its
  crypto/auth/HTTP dep current.
- **Vendor with care.** Vendoring buys reproducibility, costs visibility into upstream fixes.

## Delivery

- **Small, reversible changes.** Easier to review, easier to roll back, easier to bisect.
- **Feature-flag risky paths** so they can be turned off without a deploy.
- **Migrations are two-phase**: expand (additive change), then contract (remove old), with the application
  tolerant of both shapes in between.
- **No "ship and check Slack."** Define a success metric before deploy.
- **Rollback is part of the plan**, not a hope.

## Backward compatibility

- **Public interfaces are forever** until explicitly versioned out.
- **Adding** is safe; **removing** is breaking; **changing meaning** is breaking even with the same name.
- **Deprecate, don't delete.** Mark, warn, set a removal date, then remove.

## Performance

- **Measure first.** A clean implementation that's fast enough beats a clever one that's faster than needed.
- **Big-O before constants.** A correct algorithm with bad inner loops can be tuned; the reverse is rewriting.
- **N+1 is the most common bug** in code that touches a database. Look for it in every PR.

## Process hygiene

- **A red CI is a stop-the-line event.** Never merge through red.
- **Don't disable failing tests** to unblock a release. Either fix the test or the code.
- **Don't bypass hooks** (`--no-verify`, `--skip-checks`) unless the human explicitly asks.
- **Commits tell a story.** Each one is a coherent step a reviewer can understand on its own.
