# Documents

Library code for a documents service shared by several organisations. Callers pass a store made by `createStore` in `src/store.mjs`.

- A user is `{ id, orgId, roles }`, where roles may hold `viewer`, `editor` and `admin`.
- A document is `{ id, orgId, ownerId, title, body, archived }`.
- `createDoc`, `readDoc`, `updateDoc` and `deleteDoc` are in `src/docs.mjs`. Each takes the acting user's id as its second argument.
- Operations return `{ ok: true, value }` or `{ ok: false, error: { code } }`.

Run the tests with `npm test`.
