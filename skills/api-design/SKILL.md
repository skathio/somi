---
name: api-design
description: Use when adding or changing an HTTP/gRPC/library API. Covers resource modeling, error shapes, versioning, idempotency, pagination, and backward compatibility. Optimizes for callers, not implementers.
---

# API design

You are about to expose an interface — HTTP endpoint, gRPC method, library function. Once it has one
caller you don't control, it's expensive to change. Design it for the caller's life, not your morning's
convenience.

## First principles

- **Shape for callers.** What does the consumer actually need? Don't model the interface around the
  implementation's convenience.
- **Predictable > clever.** Surprise costs every future engineer who hits it.
- **Boring & consistent.** Within an API, the same concept should use the same vocabulary, the same
  pagination, the same error shape.

## Resource modeling (REST)

- **Nouns, not verbs.** `POST /orders` to create. `POST /orders/{id}/cancel` only if "cancel" is a
  workflow that doesn't reduce to PATCH.
- **Collections + items.** `GET /orders` (list), `GET /orders/{id}` (item), `POST /orders` (create),
  `PATCH /orders/{id}` (partial update), `DELETE /orders/{id}` (remove or soft-remove).
- **Subresources** for hierarchy: `GET /orders/{id}/line-items`. Stop nesting at depth 2 unless deeper is
  semantically required.
- **Sub-actions** sparingly: `POST /orders/{id}/cancel` if `cancel` isn't a state field update.
- **IDs**: stable, opaque, externally unique. Don't expose internal autoincrement primary keys.

## Idempotency

- **Safe by default for GET/HEAD/OPTIONS.**
- **Idempotent for PUT/DELETE** (same call, same outcome).
- **POST is non-idempotent** by default. For state-changing POSTs that can be retried by clients (mobile,
  network blips, payments), accept an `Idempotency-Key` header and dedupe server-side for a TTL.

## Error shape

Pick one error envelope and use it everywhere:

```json
{
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "Order with id ord_123 not found.",
    "details": { "id": "ord_123" }
  }
}
```

- **Stable machine code**: `ORDER_NOT_FOUND` — clients branch on this.
- **Human message**: for logs / dashboards, not for end users (don't leak internals).
- **Structured details**: optional, for clients to render specific cases.
- **HTTP status carries the broad category**: 4xx caller-fault, 5xx server-fault. Don't return 200 with
  `{"error": ...}`.

## Status codes (quick cheat sheet)

| Code | When                                                                |
|------|---------------------------------------------------------------------|
| 200  | OK (GET, PUT/PATCH that returned the resource)                      |
| 201  | Created (POST that created a resource — include `Location` header) |
| 204  | No Content (DELETE, or PUT with no body)                            |
| 400  | Caller sent malformed/invalid input                                 |
| 401  | Unauthenticated                                                     |
| 403  | Authenticated but not allowed                                       |
| 404  | Resource doesn't exist OR caller can't see it (don't leak existence)|
| 409  | Conflict — concurrent modification, duplicate, state mismatch       |
| 422  | Validation failure (sometimes preferred over 400)                   |
| 429  | Rate limited (include `Retry-After`)                                |
| 5xx  | Server fault                                                        |

Don't get cute (`418`). Don't reinvent (`299`).

## Pagination

Pick one and stick to it across the API:

- **Cursor-based** (preferred for changing data): `?cursor=<opaque>&limit=N` → response includes `next_cursor`
  (or `null` at end).
- **Offset-based** (only for static data): `?offset=N&limit=N`. Bad for inserts/deletes during iteration.
- **Page-based**: `?page=N&per_page=N`. Same caveats as offset.

Always include the **next pointer** in the response, not just a flag. Callers shouldn't construct pages.

## Filtering, sorting, fields

- **Filter**: `?status=active&owner=u_123`. Document allowed fields.
- **Sort**: `?sort=created_at,-priority` (prefix `-` for descending). Allowlist sortable fields.
- **Field selection**: `?fields=id,name,status` for bandwidth-sensitive clients. Optional.

## Versioning

Choose one path:

1. **URI versioning**: `/v1/orders`. Coarse but unambiguous.
2. **Header versioning**: `Accept: application/vnd.example.v1+json`. Cleaner URIs, harder caching.
3. **No versioning, additive forever**: feasible if discipline is iron and the API is small.

**Breaking changes** require either a new version or a deprecation cycle (announce → warn → remove with
months of overlap).

## Backward compatibility

- **Adding fields** to responses is safe (clients should ignore unknowns; document this expectation).
- **Removing or renaming fields** is breaking. Deprecate, warn, then remove.
- **Changing types or meanings** is breaking even with the same name.
- **Tightening validation** is breaking (calls that used to succeed now fail).
- **Loosening validation** is generally safe.

Document a deprecation policy: `Deprecation: true` header, sunset date, alternative.

## Time

- **ISO-8601 UTC** in responses (`2026-05-20T18:42:11Z`). Never bare timestamps without timezone.
- **Accept ISO-8601** in inputs; reject otherwise. Don't guess locales.

## IDs

- **Prefix typed IDs** for human safety: `ord_8f3a...`, `usr_2c91...`. Bug reports cite IDs all the time;
  prefixed IDs prevent confusion across types.
- **Opaque**: don't encode internal facts (timestamps, shard hints) where callers can see them.

## Rate limiting

- **`429 Too Many Requests`** with `Retry-After` (seconds) and ideally `X-RateLimit-Remaining`,
  `X-RateLimit-Reset`.
- **Limit per principal**, not per IP, when there's auth.
- **Document the limits** publicly. Hidden limits cause outages.

## Security touchpoints

API design is half security design. Cross-reference [`owasp-defense`](../owasp-defense/SKILL.md):

- **AuthZ at the resource**, not just the route.
- **Idempotency keys** on state-changing public endpoints.
- **Input validation** with allowlists.
- **SSRF** if the endpoint takes a URL.
- **PII** — don't return more than the caller needs.

## When to invoke `architecture-reviewer`

- The API introduces a new contract that other systems will depend on.
- The API changes dependency direction (e.g., service A now calls service B where it used to be the
  reverse).
- The versioning strategy is being decided for the first time.
