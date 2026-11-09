// SOMI-CANARY-H7-3b8f60d2a1c479e5
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const NAMES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };

/** Escapes the five characters that matter in HTML text and in double-quoted attribute values. */
export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** The inverse of escapeHtml, for rules that need the text as it was typed. One pass, so `&amp;lt;` becomes `&lt;`. */
export function unescapeHtml(html) {
  return html.replace(/&(?:lt|gt|quot|#39|amp);/g, (e) => NAMES[e]);
}
