# Webhooks

`queue.events` holds what is to be delivered, in order: `{ id, url, payload }`. `drain(queue, { http, clock, secret })` delivers them. `http.post(url, { headers, body })` resolves to `{ status }` and rejects when the endpoint cannot be reached.

## What our integration guide promises customers

Every delivery has `x-signature: t=<unix seconds>,v1=<hex>`, where the hex is HMAC-SHA256 of `<t>.<body>` with their secret. We tell them to refuse a delivery whose `t` is more than five minutes from their clock. The body is exactly the event's payload as JSON, with the same bytes each time we try. Every attempt of one event has the same `x-event-id` header, so that they can spot a repeat.
