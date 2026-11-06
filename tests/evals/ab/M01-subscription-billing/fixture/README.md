# Subscriptions

Library code for subscription billing. There is no server: callers pass a store made by `createStore` in `src/store.mjs`.

- Money is whole cents in integers.
- Dates are UTC calendar days written `YYYY-MM-DD`, and today comes from `store.clock()`.
- A billing period is 30 days. `periodEnd` is the first day of the next period.
- Plans live in `store.plans`, each `{ id, priceCents }` for one period.
- Operations return `{ ok: true, value }` or `{ ok: false, error: { code } }`.

Run the tests with `npm test`.
