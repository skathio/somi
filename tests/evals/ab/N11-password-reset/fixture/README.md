# Accounts

The store is `{ users, sessions, resets }`. A user is `{ id, email, passwordHash }`. A session is `{ id, userId }`. Errors are `HttpError` from `src/errors.mjs`.
