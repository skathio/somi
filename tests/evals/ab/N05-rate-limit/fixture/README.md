# Items API

`createApp({ clock, keys })` returns `{ handle(req) }`. A request is `{ method, path, headers, remote }` with lower-case header names, and an answer is `{ status, headers, body }`. Errors have the body `{ error: { code, message } }`. `keys` is a `Set` of the API keys we have issued, sent as `x-api-key`. See `docs/` for how this runs in production.
