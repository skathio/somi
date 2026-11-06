# Inbound webhooks

Errors are `HttpError` from `src/errors.mjs`.

## The provider's documentation

Each delivery has a header `x-pay-signature` of comma-separated `key=value` pairs: one `t=<unix seconds>` and one or more `v1=<lowercase hex>`. There can be other keys, which you must ignore. A `v1` is the HMAC-SHA256 of the bytes `<t>.` followed by the exact request body. During a key rotation there are several `v1` values, and any one matching any of your secrets is good.

Refuse a delivery whose `t` is more than five minutes away from your clock, in either direction. The body is JSON with an `id`. We deliver at least once, so the same `id` can arrive again: remember accepted ids for as long as a delivery could still be valid.
