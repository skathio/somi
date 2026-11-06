# Orders

Orders are `{ id, createdAt, ... }` with string ids. Lists are newest first. `createdAt` is in whole seconds, so several orders can share one.

Lists take a `limit` from 1 to 100, which defaults to 20. Anything else is a bad parameter: `HttpError(400, 'invalid_query', ...)`.
