// quality/js-source.mjs: JavaScript and TypeScript source with its comments and template strings blanked, so text that only mentions code
// is not read as code. Quoted strings stay, because import paths are quoted. A slash opens a regular expression after an operator or a
// keyword that ends an expression, so a quote inside one does not open a string. Blanked text keeps its newlines, so every line stays
// where it was. tsconfig.json is read the same way, since JSON with comments is this with no templates.

const REGEX_AFTER = /(^|[(,=:[!&|?{};+\-*%<>~^]|\b(return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new))\s*$/;

function quotedEnd(text, i) {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length && text[j] !== quote && (quote === '`' || text[j] !== '\n')) j += text[j] === '\\' ? 2 : 1;
  return j + 1;
}

function regexEnd(text, i) {
  let j = i + 1;
  let inClass = false;
  while (j < text.length && text[j] !== '\n') {
    if (text[j] === '\\') j += 1;
    else if (text[j] === '[' || text[j] === ']') inClass = text[j] === '[';
    else if (text[j] === '/' && !inClass) return j + 1;
    j += 1;
  }
  return j;
}

const until = (text, from, mark, past) => { const at = text.indexOf(mark, from); return at === -1 ? text.length : at + past; };
// What opens at a position, where it ends, and whether it is blanked.
const OPENERS = [
  ['//', (text, i) => until(text, i, '\n', 0), true],
  ['/*', (text, i) => until(text, i + 2, '*/', 2), true],
  ['`', quotedEnd, true],
  ['"', quotedEnd, false],
  ["'", quotedEnd, false],
];

function sourcePiece(text, i, before) {
  const opener = OPENERS.find(([mark]) => text.startsWith(mark, i));
  if (opener) return { end: opener[1](text, i), blank: opener[2] };
  return { end: text[i] === '/' && REGEX_AFTER.test(before) ? regexEnd(text, i) : i + 1, blank: false };
}

/** The text with its comments and template strings blanked to spaces, newlines kept. */
export function codeOnly(text) {
  const parts = [];
  let tail = '';
  for (let i = 0; i < text.length;) {
    const { end, blank } = sourcePiece(text, i, tail);
    const piece = text.slice(i, end);
    parts.push(blank ? piece.replace(/[^\n]/g, ' ') : piece);
    if (!blank && piece.trim() !== '') tail = (tail + piece).slice(-12);
    i = end;
  }
  return parts.join('');
}
