# Spec — backward paging

## 1. Purpose

`listPage()` only walks a list forward today. A caller reviewing a long list (support tooling, an
admin console) has no way to step back to a page it already saw without discarding its position
and re-walking from the start. Add a way to fetch the page immediately before the caller's current
position, using the same cursor format the forward direction already returns.

## 2. Requirements

- **R1** — `listPage()` takes an optional `direction` argument (`'forward'`, the default and
  today's only behaviour, or `'backward'`). In `'backward'` mode: a call with no cursor returns
  the list's last page (the mirror of `'forward'` with no cursor returning the first page); a
  call with a cursor returns the page immediately before the position that cursor marks.
- **R2** — Existing `'forward'` behaviour is unchanged for a normal page, a cursor issued for a
  list far shorter than it currently is, and a malformed cursor string.
- **R3** — A cursor is a single format usable with either direction — one obtained from a
  `'forward'` call may be resubmitted with `direction: 'backward'`, and vice versa.
- **R4** — `listPage`'s and `decodeCursor`'s export surfaces are unchanged.

## 3. Non-goals

- Any change to the cursor's encoding format or its version tag.
- Enforcing a maximum `pageSize`.
- Sorting or filtering `items` — this module receives them already ordered.
- A lookup by record identity. Backward paging only walks relative to an existing cursor or the
  list's own ends.

## 5. Core decisions

None outstanding — the implementation shape is up to the coder.
