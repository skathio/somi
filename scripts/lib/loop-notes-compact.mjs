// loop-notes-compact.mjs -- the text half of the diary writer: one entry's shape, where it goes, and the 40/15
// compaction rule of templates/DIARY.md.tmpl. Pure string functions, no file access (loop-notes.mjs does the IO
// and the path confinement). Callers pass already-sanitised one-line fields; nothing here reads the environment.

export const CATEGORIES = ['plan-change', 'blocker', 'unblock', 'discovery', 'decision-change', 'note', 'review-feedback'];
const MOVABLE = new Set(['note', 'discovery', 'unblock', 'blocker', 'review-feedback']);
export const MAX_ENTRIES = 40;
export const KEEP_NEWEST = 15;

// An entry starts at a line beginning `## `; text before the first one is the file's preamble.
const SPLIT = /^(?=## )/m;
const withNewline = (s) => (s.endsWith('\n') ? s : `${s}\n`);

// A diary or archive in template shape: a `# ` title first, and no carriage returns (a CRLF file is not ours).
export const archiveShape = (text) => text.startsWith('# ') && !text.includes('\r');
export const diaryShape = (text) => archiveShape(text) && text.split(SPLIT).length > 1;

export const archiveHead = (slug) => `# Diary archive — ${slug}\n\n> Entries moved out of [\`diary.md\`](./diary.md) by compaction, verbatim: batches oldest first, newest first within a batch.\n\n`;

export function formatEntry({ stamp, title, category, phase, body }) {
  return `## ${stamp} — ${title}\n\n**Category**: \`${category}\`\n**Phase**: ${phase}\n\n${body ? `${body}\n\n` : ''}---\n\n`;
}

// Newest first: the new entry goes in front of the first existing one. Null when the file is not a diary.
export function insertEntry(text, entry) {
  if (!diaryShape(text)) return null;
  const at = text.search(/^## /m);
  return text.slice(0, at) + entry + text.slice(at);
}

// Category lives in the first lines under the heading; an entry whose category cannot be read is never moved.
const categoryOf = (chunk) => /^\*\*Category\*\*: `?([a-z-]+)`?/m.exec(chunk.split('\n').slice(1, 6).join('\n'))?.[1];
const dateOf = (chunk) => /^## (\d{4}-\d{2}-\d{2})/.exec(chunk)?.[1] ?? '?';

// More than MAX_ENTRIES entries: every movable entry older than the newest KEEP_NEWEST leaves, and one `Compacted:`
// entry takes the place of the newest of them. decision-change, plan-change and earlier Compacted entries never move. Null when the
// diary is within bounds or nothing is movable; else { diary, archived } where `archived` is the moved text, verbatim.
export function compactDiary(text, stamp) {
  const [head, ...chunks] = text.split(SPLIT);
  if (chunks.length <= MAX_ENTRIES) return null;
  const moves = chunks.map((c, i) => i >= KEEP_NEWEST && MOVABLE.has(categoryOf(c)) && !/^## [\d-]+ [\d:]+ — Compacted: /.test(c));
  const moved = chunks.filter((_, i) => moves[i]);
  if (moved.length === 0) return null;
  const dates = moved.map(dateOf).sort();
  const summary = formatEntry({
    stamp, title: `Compacted: ${dates[0]} .. ${dates[dates.length - 1]}`, category: 'note', phase: 'work-item-wide',
    body: `${moved.length} older entries moved verbatim to [\`diary-archive.md\`](./diary-archive.md); decision-change and plan-change entries stay here.`,
  });
  let placed = false;
  const kept = chunks.flatMap((c, i) => {
    if (!moves[i]) return [withNewline(c)];
    if (placed) return [];
    placed = true;
    return [summary];
  });
  return { diary: head + kept.join(''), archived: moved.map(withNewline).join('') };
}
