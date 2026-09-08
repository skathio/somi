// Scorer-side CONTROL: both A and B fixed.
//
// decodeCursor's bound is loosened (`>` not `>=`) AND the shrink branch returns null instead of
// re-minting a cursor. Exhibits neither defect. See fixtures/README.md.
//
// Self-contained -- does not import src/pagination/, so it can be substituted for the shipped
// module wholesale at scoring time, the same convention task02-code-control.mjs uses for
// token.mjs. Lives OUTSIDE multipass-code/.

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
    // B: fixed. Nothing left to return -- tell the caller to stop, a null cursor.
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
