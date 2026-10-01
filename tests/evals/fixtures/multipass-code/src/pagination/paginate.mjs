// Fetches one page of a list, given an opaque cursor from a previous call (or none, for the
// first page).
import { encodeCursor, decodeCursor } from './cursor.mjs';

/**
 * @param {unknown[]} items    the full list being paged (in-memory; the store is out of scope)
 * @param {string|null|undefined} cursor  a cursor from a previous call, or nullish for page 1
 * @param {number} pageSize
 * @returns {{ items: unknown[], nextCursor: string|null, remaining: number }}
 */
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
    // The list has shrunk since this cursor was issued (items removed) -- there is nothing
    // left to return, and the caller should stop paging.
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
