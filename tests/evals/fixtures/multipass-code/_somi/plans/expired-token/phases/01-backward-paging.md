# Phase 1 — Add backward paging

## Iterations

### Iteration 1.1 — support paging backward

- **Scope**: `listPage()` in `src/pagination/paginate.mjs` (backed by the cursor codec in
  `src/pagination/cursor.mjs`) only walks a list forward. Add a `direction` option so a caller
  can fetch the page immediately before its current position, not just the page after it.
- **Files (approx)**: `src/pagination/cursor.mjs`, `src/pagination/paginate.mjs`,
  `tests/pagination/paginate.test.mjs`, `.somi/plans/expired-token/progress.md`,
  `.somi/plans/expired-token/diary.md`.
- **Acceptance**: `direction: 'backward'` returns the list's last page when no cursor is given,
  and the page before a given cursor's position otherwise; existing forward behaviour and
  existing tests stay green; **`listPage`'s and `decodeCursor`'s export surfaces are
  unchanged**.
- **Rollback**: revert; only forward paging is available again.
