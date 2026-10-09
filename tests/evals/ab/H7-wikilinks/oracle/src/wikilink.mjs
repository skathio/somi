// SOMI-CANARY-H7-3b8f60d2a1c479e5
import { escapeHtml, unescapeHtml } from './escape.mjs';

const tidy = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * HTML for `[[name]]` or `[[name|shown]]`, or null when the brackets do not form a link. `name` and `shown` are
 * escaped text (the README's convention); `formatShown` renders the shown text like the text of an ordinary link.
 */
export function wikiLink(escapedName, escapedShown, formatShown) {
  const name = tidy(unescapeHtml(escapedName));
  if (name === '' || name.includes('\u0000')) return null;
  let address;
  try {
    address = encodeURIComponent(name);
  } catch {
    return null; // a lone surrogate cannot be written in an address
  }
  const shown = escapedShown === undefined ? '' : tidy(escapedShown);
  const text = shown === '' ? escapeHtml(name) : formatShown(shown);
  return `<a href="/wiki/${address}">${text}</a>`;
}
