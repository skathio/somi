// gates.mjs: the pure text gates behind `somi check`. Each takes lines and returns problems; none reads a file.
// They look only at lines this change added, so old text never blocks new work.

// A pointer that only resolves inside the local `.somi/` folder dangles for everyone who clones the repository.
const CODE_ID = new RegExp([
  String.raw`\bF-?\d{2,}\b`, String.raw`\bD\d+[a-z]?\b`, String.raw`decisions\.md#`, String.raw`\b[Ii]teration \d`, String.raw`\b[Pp]hase[ -]\d`,
  String.raw`\b[Mm]ilestone m?\d+\b`, String.raw`\(m\d+\)`, String.raw`\b\d\.\d+[a-z]?(?:'s)? pass \d`, String.raw`\b(?:this|that) iteration\b`,
  String.raw`\bsee (?:the )?(?:diary|phase file)\b`, String.raw`\b(?:spec|context|brief)\.md §`, String.raw`\bthis work[ -]item\b`, String.raw`\.somi/(?:plans|reviews|rd|state)\b`,
].join('|'));
const PROSE_ID = new RegExp([
  String.raw`\bF-?\d{2,}\b`, String.raw`\(D\d+[a-z]?\)`, String.raw`\bD\d+[a-z]?'s\b`, String.raw`decisions\.md#`, String.raw`\(m\d+\)`, String.raw`\.somi/(?:plans|reviews|rd)\b`,
].join('|'));

const CODE_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|sh|bash|py|rb|go|rs|java|kt|cs|c|cc|cpp|h|hpp|swift|php)$/i;
const PROSE_EXT = /\.(md|mdx|rst|adoc)$/i;
const HASH_COMMENT = /\.(sh|bash|py|rb)$/i;

function commentText(line, file) {
  const t = line.trim();
  if (HASH_COMMENT.test(file)) {
    if (t.startsWith('#!')) return null;
    if (t.startsWith('#')) return t;
    const at = line.search(/\s#\s/);
    return at === -1 ? null : line.slice(at);
  }
  if (/^(\/\/|\/\*|\*)/.test(t)) return t;
  const at = line.search(/\s\/\/\s/);
  return at === -1 ? null : line.slice(at);
}

const shown = (l) => `${l.file}: ${l.text.trim().slice(0, 120)}`;

export function planningIdProblems(addedLines) {
  const problems = [];
  for (const l of addedLines) {
    if (CODE_EXT.test(l.file)) {
      const text = commentText(l.text, l.file);
      if (text !== null && CODE_ID.test(text)) problems.push(shown(l));
    } else if (PROSE_EXT.test(l.file) && PROSE_ID.test(l.text)) problems.push(shown(l));
  }
  return problems;
}

// Shipped text that names a model generation goes stale with the next one. Off unless the repository asks for it, because a
// consumer's code may call a model on purpose.
const MODEL_NAME = /\b(claude-(?:opus|sonnet|haiku|fable|mythos)[-\w.]*|(?:opus|sonnet|haiku|fable|mythos) \d(?:\.\d)?|gpt-\d[\w.-]*|gemini-\d[\w.-]*)\b/i;

export function modelNameProblems(addedLines) {
  return addedLines.filter((l) => MODEL_NAME.test(l.text)).map(shown);
}

export function conflictMarkerProblems(addedLines) {
  return addedLines.filter((l) => /^(<{7}|>{7})( |$)/.test(l.text)).map(shown);
}

const PIPE_TO_TRUNCATOR = /\|\s*(head|tail|cut)\b/;
const PIPEFAIL = /^\s*set\s+(-[a-z]*o\s+pipefail|-[a-z]+\s+pipefail|-o\s+pipefail)/m;

// A pipe into head, tail or cut hides the left command's exit status. `# pipe-ok` marks a line where the status does not matter.
export function pipefailProblems(file, text) {
  const problems = [];
  if (!PIPEFAIL.test(text)) problems.push(`${file}: no "set -o pipefail"`);
  text.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('#') || !PIPE_TO_TRUNCATOR.test(t) || t.includes('# pipe-ok')) return;
    problems.push(`${file}:${i + 1}: a pipe into head, tail or cut hides a failure; mark "# pipe-ok" if the status does not matter`);
  });
  return problems;
}
