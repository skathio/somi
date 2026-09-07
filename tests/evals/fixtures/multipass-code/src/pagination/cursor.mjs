// Pagination cursor codec. A cursor is opaque to callers -- it encodes the offset to resume
// listing from, nothing else.

const VERSION = 1;

function encode(offset) {
  return Buffer.from(JSON.stringify({ v: VERSION, offset }), 'utf8').toString('base64url');
}

function decode(raw) {
  return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
}

/** Encodes an offset into an opaque cursor string. */
export function encodeCursor(offset) {
  return encode(offset);
}

/**
 * Decodes a cursor string back to its offset, validated against the current item count.
 * @param {string} cursor
 * @param {number} total  current number of items in the list being paged
 * @returns {number} the offset to resume from
 * @throws {Error} on a malformed cursor, or one out of range for `total`
 */
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
