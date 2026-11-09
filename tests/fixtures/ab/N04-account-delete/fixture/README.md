# Accounts service

Library functions over a plain store: `{ users, invoices, sessions, audit }`. See `docs/` for company policies that apply to this code.

Errors are `HttpError` from `src/errors.mjs`. Every change to an account appends to `store.audit`.
