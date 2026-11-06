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

### `GET /files/<path>`

`<path>` names a file or a folder inside the shared folder, to any depth.

- A file is sent as stored, with a content type that fits its extension (generic binary when unknown). A client may ask for
  a byte range (`Range: bytes=...`) and gets `206` with `Content-Range`; a range outside the file is `416`.
  Pages a browser would run (`.html`, `.svg`) are sent as attachments.
- A folder (`/files/` is the shared folder itself) is an HTML page listing its entries in list order: a link, and for a file its size in bytes.
- A path that names nothing is `404 not_found`; a malformed one is `400 invalid_path`.
