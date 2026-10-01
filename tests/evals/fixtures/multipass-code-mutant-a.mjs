// Scorer-side MUTANT-A: A fixed, B still broken -- the state that newly exposes B.
//
// A is decodeCursor's bound check (`>=` -> `>`): offset === total is the boundary a list leaves
// behind when it shrinks after a cursor was issued, and it is a legitimate "nothing left" state,
// not an out-of-range one. Loosening it lets that boundary reach paginate's shrink branch below,
// which still re-mints a cursor instead of returning null -- B, now observable
// (decisions.md#d7, phases/02 2.2).
//
// Self-contained -- does not import src/pagination/, so it can be substituted for the shipped
// module wholesale at scoring time, the same convention task02-code-mutant.mjs uses for
// token.mjs. Lives OUTSIDE multipass-code/. See fixtures/README.md.

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

/** @throws {Error} malformed cursor, or (A fixed) truly out of range -- offset > total only. */
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
  if (payload.offset > total) {
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
    // B: unfixed. Re-mints a cursor pointing at the same offset instead of returning null.
    return { items: [], nextCursor: encodeCursor(offset), remaining: 0 };
  }

  const slice = items.slice(offset, offset + pageSize);
  const nextOffset = offset + slice.length;
  return {
    items: slice,
    nextCursor: nextOffset < items.length ? encodeCursor(nextOffset) : null,
    remaining: items.length - nextOffset,
  };
}
