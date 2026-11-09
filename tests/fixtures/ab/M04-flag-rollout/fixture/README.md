# Feature flags

Library code for feature flags. Callers pass a store made by `createStore` in `src/store.mjs`.

- `defineFlag(store, name)` adds a flag that is off.
- `setEnabled(store, name, enabled)` turns it on or off for everyone.
- `isEnabled(store, name)` answers whether it is on.
- Changes return `{ ok: true, value }` or `{ ok: false, error: { code } }`, and each one is recorded in `store.audit`.
- `src/hash.mjs` has a stable string hash, `fnv1a32`.

Run the tests with `npm test`.
