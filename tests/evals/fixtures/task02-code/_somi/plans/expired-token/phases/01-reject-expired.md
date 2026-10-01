# Phase 1 — Reject an expired token

## Iterations

### Iteration 1.1 — reject an expired token

- **Scope**: `verifyToken()` in `src/auth/token.mjs` checks the signature but never compares `exp`
  to the current time, so an expired token authenticates.
- **Files (approx)**: `src/auth/token.mjs`, `tests/auth/token.test.mjs`,
  `.somi/plans/expired-token/progress.md`, `.somi/plans/expired-token/diary.md`.
- **Acceptance**: an expired token is rejected; existing tests stay green; **`verifyToken`'s export
  surface is unchanged** — `session.mjs` and downstream callers import it directly.
- **Rollback**: revert; an expired token authenticates again.
