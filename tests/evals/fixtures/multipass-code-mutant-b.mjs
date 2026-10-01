// Scorer-side MUTANT-B: B "fixed" alone, A still broken -- the construction-only state.
//
// B's shrink branch is fixed (returns nextCursor: null, not a re-minted cursor). A is UNCHANGED
// from shipped: decodeCursor's bound stays `>=`, so it still throws before this branch can ever
// run. This file must therefore be observably IDENTICAL to the shipped module -- proving B's own
// fix has no effect while A remains broken (the gate runs A -> B, not the reverse;
// decisions.md#d7, phases/02 2.2, this phase's own preamble). Constructed as the smallest
// possible diff against shipped (src/pagination/{cursor,paginate}.mjs): every code line matches
// except this one branch's return, so the equality check in evals-fixtures.sh has no incidental
// difference to trip on.
//
// Self-contained -- does not import src/pagination/, so it can be substituted for the shipped
// module wholesale at scoring time. Lives OUTSIDE multipass-code/. See fixtures/README.md.

const VERSION = 1;

function encode(offset) {
  return Buffer.from(JSON.stringify({ v: VERSION, offset }), 'utf8').toString('base64url');
}
function decode(raw) {
  return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
}

export function encodeCursor(offset) {
  return encode(offset);
}

/** @throws {Error} malformed cursor, or (A unfixed) offset >= total, including the boundary. */
export function decodeCursor(cursor, total) {
  if (typeof cursor !== 'string' || cursor.length === 0) {
    throw new Error('malformed cursor');
  }
  let payload;
  try {
    payload = decode(cursor);
  } catch {
    throw new Error('malformed cursor');
  }
  if (
    payload.v !== VERSION ||
    typeof payload.offset !== 'number' ||
    !Number.isInteger(payload.offset) ||
    payload.offset < 0
  ) {
    throw new Error('malformed cursor');
  }
  if (payload.offset >= total) {
    throw new Error('cursor out of range');
  }
  return payload.offset;
}

export function listPage(items, cursor, pageSize) {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error('invalid page size');
  }

  if (cursor == null) {
    const slice = items.slice(0, pageSize);
    return {
      items: slice,
      nextCursor: slice.length < items.length ? encodeCursor(slice.length) : null,
      remaining: items.length - slice.length,
    };
  }

  const offset = decodeCursor(cursor, items.length);

  if (offset === items.length) {
    // B: fixed. Unreachable -- A's bound (above) throws on this exact offset first, always.
    return { items: [], nextCursor: null, remaining: 0 };
  }

  const slice = items.slice(offset, offset + pageSize);
  const nextOffset = offset + slice.length;
  return {
    items: slice,
    nextCursor: nextOffset < items.length ? encodeCursor(nextOffset) : null,
    remaining: items.length - nextOffset,
  };
}
