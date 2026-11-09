const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes the five characters that matter in HTML text and in double-quoted attribute values. */
export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
