# Orders

Money is in whole cents. An order is `{ id, total, tax, status, refunds }`, where `total` includes `tax`. Status goes `pending`, `paid`, then `partially_refunded` or `refunded`.

## Money rules

Every money movement is one balanced transaction through `post` in `src/ledger.mjs`. A sale moves `total` into `cash`, out of `revenue` (net of tax) and out of `tax_payable` (see `src/orders.mjs`). A refund reverses that for its amount.

The tax in a refund is the order's tax in proportion to the amount, rounded to the cent. Across all of an order's refunds the tax must add up to exactly the order's tax.

Asking again with a `requestId` already used for the order changes nothing and gives the original answer.

Every refund puts one message in `store.outbox`: `{ type: 'order.refunded', orderId, amount, remaining }`.
