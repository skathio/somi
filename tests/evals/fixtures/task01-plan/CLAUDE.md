# Project instructions

## Stack

- Node 20, plain `.mjs`. Postgres via a thin client in `src/db/`.

## Conventions

- **Migrations are reversible; the down migration ships in the same PR as the up.**
- Errors surface as `{ status, body: { error } }` from handlers; never throw past the boundary.
- No new runtime dependency without a note in the PR describing why.
