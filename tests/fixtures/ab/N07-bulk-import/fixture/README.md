# Users

`addUser(store, row, now)` adds one user. The store is `{ users, audit, nextId }`.

The rules: an email has an `@` with something on either side, and is unique among users regardless of case or surrounding space. A user's `plan` is `free` or `paid`, and defaults to `free`. A user's `id` comes from `store.nextId`, in order, with no gaps. Every added user has one audit entry `{ type: 'user.added', id, at }`.
