# Example — `/ship` end-to-end pipeline

A condensed transcript of using `/ship` for a tiny feature: **add a `--dry-run` flag to the `migrate`
CLI**. Shows the human-in-the-loop gates between stages.

---

## Turn 1 — User invokes `/ship`

```
> /ship Add a --dry-run flag to the migrate CLI that prints the SQL it would execute without
        applying any changes. Should work for both up and down migrations.
```

## Turn 2 — Claude (Stage 1: Plan)

> Running planning workflow.
>
> [reads `cmd/migrate/main.go`, `internal/migrate/runner.go`, existing tests]
>
> [writes `PLAN.md`]

> **Summary**: Adding `--dry-run` to `migrate up` and `migrate down`. Implementation gates SQL
> execution on the flag; otherwise prints the formatted SQL to stdout. Two iterations: (1) thread the
> flag through the CLI and `Runner.Apply`; (2) add tests + docs.
>
> **Risks**: (a) printing SQL with secrets — none of our migrations embed secrets, but worth a one-line
> redaction pass; (b) ordering — dry-run must still resolve dependencies in the same order as the real
> apply.
>
> **Open questions**: none — straightforward.
>
> Plan ready. Reply `approve` to proceed to Stage 2 (coding the first iteration), `revise <notes>`
> to iterate on the plan, or `abort` to stop.

## Turn 3 — User

```
> approve
```

## Turn 4 — Claude (Stage 2: Code, Iteration 1)

> Coding Phase 1 / Iteration 1: thread `--dry-run` through CLI and `Runner.Apply`.
>
> [reads relevant files]
> [edits `cmd/migrate/main.go` to register the flag and pass it]
> [edits `internal/migrate/runner.go` to add `DryRun bool` to options and short-circuit `Exec` to
>  `fmt.Println`]
>
> **What changed**:
> - `cmd/migrate/main.go` — registered `--dry-run` flag; passed through to `Runner.Apply`.
> - `internal/migrate/runner.go` — added `Options.DryRun`; in dry-run mode, prints `BEGIN; <SQL>;
>   COMMIT;` for each migration in dependency order without opening a transaction.
>
> **Why**: matches Phase 1 / Iteration 1 of the plan.
>
> **Not done**: tests + docs (planned for iteration 2).
>
> **What to look at**: the dependency-resolution path in `runner.go:142-158` — it's the same code
> path as a real apply, which is the whole point. If you re-ordered migrations, dry-run output reorders too.
>
> **Tradeoffs taken**: None material.
>
> Iteration 1 implemented. Reply `review` to invoke the reviewer on this iteration, `next` to proceed
> to the next iteration without a review, or `stop`.

## Turn 5 — User

```
> review
```

## Turn 6 — Claude (Stage 3: Review)

> Running reviewer.
>
> [reads the diff, the plan, `Runner.Apply` callers]
>
> **Verdict**: `approve-with-comments`.
>
> **Counts**: 0 Blockers, 0 Majors, 1 Minor, 1 Nit.
>
> **Top findings**:
> - **[Minor / Medium]** Dry-run prints `BEGIN/COMMIT` per migration, but real apply uses a single
>   transaction per `up` batch. Output suggests semantics that don't quite match. Suggest matching
>   the real shape or noting the divergence in the printed header.
> - **[Nit / Low]** `Options.DryRun bool` could be `Options.Mode runner.Mode` (`apply` or `dryRun`)
>   to leave room for future modes (`explain`, `verify`); not worth doing now.
>
> Full review in `REVIEW.md`. Reply `next` to proceed to iteration 2 (tests + docs), `revise` to
> address the Minor finding first, or `stop`.

## Turn 7 — User

```
> revise — address the Minor finding by matching the real transaction shape in dry-run output.
```

## Turn 8 — Claude (Stage 2 again, addressing review feedback)

> Adjusting iteration 1 per review feedback.
>
> [edits `internal/migrate/runner.go` so dry-run emits one `BEGIN` at the start of a batch and one
>  `COMMIT` at the end, matching real apply semantics]
>
> Done. Re-running review …
>
> **Verdict**: `approve` (clean).
>
> Reply `next` to proceed to iteration 2.

## Turn 9 — User

```
> next
```

## Turn 10 — Claude (Stage 2, Iteration 2)

> Coding Phase 1 / Iteration 2: tests + docs.
>
> [writes table tests for dry-run output; updates `docs/migrate.md`]
>
> ... [final review on iteration 2 — clean approve] ...
>
> Pipeline complete. Two iterations landed, one review cycle of feedback applied.
> Plan / iteration / review artifacts: `PLAN.md`, `REVIEW.md`. Ready for PR.

---

## What the example demonstrates

- **Hard gates** between stages — Claude never silently progresses.
- **One iteration per coding cycle** — even though the plan had two iterations, each one got its own
  code → review loop.
- **Review feedback flows back to coding**, not into "we'll fix it later."
- **The reviewer rejects weak choices** rather than rubber-stamping (the dry-run transaction
  semantics finding would have been easy to miss without the explicit comparison to real apply
  behavior).
- **Artifacts persist** — `PLAN.md` and `REVIEW.md` are auditable after the session ends.
