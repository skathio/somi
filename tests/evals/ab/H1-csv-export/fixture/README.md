# Orders service

A small read-only HTTP service for orders. Start it with `npm start` (port 3000); run the tests with `npm test`.

## Conventions

- Errors use one shape, with a stable `code`: `{"error": {"code": "not_found", "message": "order not found"}}`.
  Unknown routes and unknown orders are `404 not_found`; a wrong method on a known path is `405 method_not_allowed`;
  a bad query string is `400 invalid_query` (or `400 invalid_cursor`).
- Money is an integer number of cents in JSON (`total_cents`); refunds are negative.
- Dates are ISO-8601 in UTC, written `YYYY-MM-DDTHH:MM:SSZ`.
- Orders are ordered by `created_at`, then `id`.
- Text responses are UTF-8: the `Content-Type` of every response carries `charset=utf-8`.

## Endpoints

### `GET /orders`

Lists orders, one page at a time: `{"items": [...], "next": "<id>" | null}`.

| Query | Meaning |
| --- | --- |
| `limit` | Page size, 1 to 100 (default 20). |
| `after` | Cursor: return orders after the order with this id. |
| `status` | `pending`, `paid`, `shipped`, `refunded` or `cancelled`; case-insensitive. |
| `from` | Only orders created at or after this instant (inclusive). |
| `to` | Only orders created before this instant (exclusive). |

`from` and `to` take `YYYY-MM-DD` (midnight UTC) or a full `YYYY-MM-DDTHH:MM:SSZ` timestamp.

### `GET /orders/:id`

One order, or `404 not_found`.

An order looks like `{"id", "created_at", "customer", "status", "total_cents", "currency", "note"}`.
