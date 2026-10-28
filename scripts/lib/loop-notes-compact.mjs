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

// Replay guard: the newest entry is, text for text, the one about to be written (stamp, title, category, phase, body).
export const isReplay = (text, entry) => text.split(SPLIT)[1]?.trimEnd() === entry.trimEnd();

// A title that reads as a running summary is reserved: only compactDiary writes one.
export const isSummaryTitle = (title) => /^\s*compacted\s*:/i.test(title);

// Category lives in the first lines under the heading; an entry whose category cannot be read is never moved.
const categoryOf = (chunk) => /^\*\*Category\*\*: `?([a-z-]+)`?/m.exec(chunk.split('\n').slice(1, 6).join('\n'))?.[1];
const summaryEntry = (stamp, from, to, count) => formatEntry({
  stamp, title: `Compacted: ${from} .. ${to}`, category: 'note', phase: 'work-item-wide',
  body: `${count} older entries moved verbatim to [\`diary-archive.md\`](./diary-archive.md); decision-change and plan-change entries stay here.`,
});
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A prior summary is one whose whole chunk is what summaryEntry emits (so a hand-made or forged entry is never
// "ours"), with a count of at most six digits (always a safe integer). Groups: 1 = from, 2 = to, 3 = count.
const RUNNING = new RegExp(`^${escapeRe(summaryEntry('<stamp>', '<from>', '<to>', '<count>').trimEnd())}\\s*$`
  .replace('<stamp>', '\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d').replace('<from>', '(\\d{4}-\\d\\d-\\d\\d)')
  .replace('<to>', '(\\d{4}-\\d\\d-\\d\\d)').replace('<count>', '(\\d{1,6})'));
const dateOf = (chunk) => /^## (\d{4}-\d{2}-\d{2})/.exec(chunk)?.[1] ?? '?';

// More than MAX_ENTRIES entries: every movable entry older than the newest KEEP_NEWEST leaves, and one `Compacted:`
// entry takes the place of the newest of them -- or, when an earlier Compacted entry of our own shape exists, replaces
// it with the date span widened and the count summed, so the diary keeps one running summary. An entry that only
// resembles a summary is not ours and is left alone. decision-change, plan-change and Compacted entries never move.
// Null when the diary is within bounds or nothing is movable; else { diary, archived } where `archived` is the moved
// text, verbatim.
export function compactDiary(text, stamp) {
  const [head, ...chunks] = text.split(SPLIT);
  if (chunks.length <= MAX_ENTRIES) return null;
  const moves = chunks.map((c, i) => i >= KEEP_NEWEST && MOVABLE.has(categoryOf(c)) && !/^## [\d-]+ [\d:]+ — Compacted: /.test(c));
  const moved = chunks.filter((_, i) => moves[i]);
  if (moved.length === 0) return null;
  const prior = chunks.findIndex((c) => RUNNING.test(c));
  const before = prior < 0 ? null : RUNNING.exec(chunks[prior]);
  const dates = moved.map(dateOf).concat(before ? [before[1], before[2]] : []).sort();
  const summary = summaryEntry(stamp, dates[0], dates[dates.length - 1], moved.length + (before ? Number(before[3]) : 0));
  const at = before ? prior : moves.indexOf(true);
  const kept = chunks.flatMap((c, i) => (i === at ? [summary] : moves[i] ? [] : [withNewline(c)]));
  return { diary: head + kept.join(''), archived: moved.map(withNewline).join('') };
}
