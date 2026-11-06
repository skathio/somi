# Partner API client

`send(request, { http, clock, sleep })`. `http(request)` resolves to `{ status, headers, body }`, with lower-case header names.

## The partner's documentation

When busy we answer 429 or 503, usually with `Retry-After`, as HTTP defines it. Wait at least that long. With no header, wait 1 second and then double each time. Try at most 5 times in all.

Only repeat a request that is safe to repeat: GET, HEAD, PUT and DELETE, or anything sent with an `idempotency-key` header.

Your integration must not hold a caller for more than 60 seconds of waiting in total. If the next wait would pass that, stop and hand back the last answer.
