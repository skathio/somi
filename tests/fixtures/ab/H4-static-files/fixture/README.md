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
