import { escapeHtml } from './escape.mjs';

// Inline markup works on text that is already escaped (see the README), so every pattern below sees `&amp;`, never `&`.
const MARK = '\u0000';
const CODE = /`([^`\n]+)`/g;
const LINK = /\[([^\[\]]+)\]\(([^()\s]*)\)/g;
const STRONG = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g;
const EM = /(\*|_)(?=\S)(.+?)(?<=\S)\1/g;
const TOKEN = new RegExp(`${MARK}(\\d+)${MARK}`, 'g');
const SAFE_TARGET = /^(https?:\/\/|mailto:|\/|#)/i;

// A finished piece of HTML is parked in `parts` and replaced by a token, so the later passes cannot touch it.
function keep(parts, html) {
  parts.push(html);
  return `${MARK}${parts.length - 1}${MARK}`;
}

function anchor(target, innerHtml) {
  if (!SAFE_TARGET.test(target)) return innerHtml;
  const external = /^https?:/i.test(target);
  return `<a href="${target}"${external ? ' rel="noopener"' : ''}>${innerHtml}</a>`;
}

function format(escaped, parts) {
  let s = escaped.replace(CODE, (_, body) => keep(parts, `<code>${body}</code>`));
  s = s.replace(LINK, (_, text, target) => keep(parts, anchor(target, format(text, parts))));
  return s.replace(STRONG, '<strong>$2</strong>').replace(EM, '<em>$2</em>');
}

function expand(s, parts) {
  while (s.includes(MARK)) s = s.replace(TOKEN, (_, i) => parts[Number(i)]);
  return s;
}

/** Renders one run of inline markdown (a heading, a list item or a paragraph's lines) to HTML. */
export function renderInline(markdown) {
  const parts = [];
  return expand(format(escapeHtml(markdown.replaceAll(MARK, '')), parts), parts);
}
