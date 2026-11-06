import { escapeHtml } from './escape.mjs';
import { renderInline } from './inline.mjs';

const FENCE = /^```\s*([\w-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const ITEM = /^[-*+]\s+(.*)$/;

const isBlockStart = (line) => FENCE.test(line) || HEADING.test(line) || ITEM.test(line);

function fenced(lines, from) {
  const lang = FENCE.exec(lines[from])[1];
  const body = [];
  let i = from + 1;
  while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
  const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
  return [`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`, i + 1];
}

function list(lines, from) {
  const items = [];
  let i = from;
  while (i < lines.length && ITEM.test(lines[i])) items.push(`<li>${renderInline(ITEM.exec(lines[i++])[1])}</li>`);
  return [`<ul>\n${items.join('\n')}\n</ul>`, i];
}

function paragraph(lines, from) {
  const text = [];
  let i = from;
  while (i < lines.length && lines[i].trim() !== '' && (i === from || !isBlockStart(lines[i]))) text.push(lines[i++]);
  return [`<p>${renderInline(text.join('\n'))}</p>`, i];
}

/** Turns lines into HTML blocks: fenced code, headings, bullet lists and paragraphs. */
export function renderBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let html;
    if (line.trim() === '') { i++; continue; }
    if (FENCE.test(line)) [html, i] = fenced(lines, i);
    else if (HEADING.test(line)) {
      const [, hashes, text] = HEADING.exec(line);
      html = `<h${hashes.length}>${renderInline(text)}</h${hashes.length}>`;
      i++;
    } else if (ITEM.test(line)) [html, i] = list(lines, i);
    else [html, i] = paragraph(lines, i);
    out.push(html);
  }
  return out;
}
