# Catalog

Library code for a product catalog. Callers pass a store made by `createStore` in `src/store.mjs`.

- A product is `{ sku, name, priceCents, stock }`. Money is whole cents in integers.
- `addProduct`, `getProduct` and `listProducts` are in `src/catalog.mjs`. `listProducts` sorts by sku.
- Operations return `{ ok: true, value }` or `{ ok: false, error: { code } }`.

Run the tests with `npm test`.
