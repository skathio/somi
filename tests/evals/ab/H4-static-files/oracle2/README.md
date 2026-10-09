<!-- SOMI-CANARY-H4-9b3f2a61d07e4c58 -->
# Share service

A small HTTP service for a shared folder. Start it with `npm start` (port 3000); run the tests with `npm test`.

## Layout

- `shared/` is the shared folder: the files and folders colleagues exchange.
- `shared-internal/` is the staff archive.
- `config/` holds service settings.
- `src/` is the service, `test/` its tests.

## Conventions

- Errors use one shape, with a stable `code`: `{"error": {"code": "not_found", "message": "no such route"}}`.
  Unknown routes are `404 not_found`; a wrong method on a known path is `405 method_not_allowed`;
  a bad request is `400` with a stable `code`.
- Text responses are UTF-8: the `Content-Type` of every response carries `charset=utf-8`.
- File lists put folders before files; within each group, names are ordered by their lower-case form, character by character.
- Sizes are whole bytes.

## Endpoints

### `GET /health`

`{"status": "ok"}`.

### `GET /api/files`

The entries directly inside the shared folder, in list order: `{"items": [{"name", "type", "size"}]}`.
`type` is `file` or `dir`; `size` is a number of bytes, or `null` for a folder.

### `GET /files/` and `GET /files/<path>`

- `GET /files/<path>` sends the file `<path>` of the shared folder (any depth) as stored, with the content type of its extension,
  and honours `Range` requests (`206`, or `416` with `Content-Range: bytes */<size>`).
- `GET /files/` and `GET /files/<folder>/` are HTML pages listing the entries in list order with links and sizes in bytes.
- Unknown paths are `404 not_found`; malformed ones are `400 invalid_path`.
