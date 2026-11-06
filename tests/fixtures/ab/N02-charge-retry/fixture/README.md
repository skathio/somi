# Payments

`chargeOrder(order, { gateway, store, retries = 3 })` charges an order and returns `{ chargeId, amount }`.

## The gateway

`gateway.charge({ amount, idempotencyKey })` resolves to `{ id }`. Two calls with the same `idempotencyKey` move money once and resolve to the same `id`, for as long as the key is remembered. A call with a new key is a new charge.

It rejects with an error carrying `retryable`. `retryable: true` means the outcome is unknown: the charge may or may not have gone through (a timeout, for example). `retryable: false` means the charge was refused and no money moved (a declined card, for example).

## The store

`store.get(orderId)` and `store.set(orderId, value)` are async and survive a restart. It holds what we know about an order's charge. Nothing else writes to it.
