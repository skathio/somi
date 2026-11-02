// loop-notes.mjs -- the loop's two narrow writers into a work item (the tool writes only these): a diary entry at the
// top of diary.md (40/15 compaction into diary-archive.md), and in progress.md only the `| N.M |` row of the iteration
// table, the done count in that phase's row of the phase table (`a/b` in `Iterations done / total`, set to the number of
// the phase's rows marked done; recounted on every row mark, `open` included) and the `**Last activity**` line (a
// missing one is inserted at the end of `## Status`). Writes are confined to <root>/.somi/plans/<slug>/: slug and
// iteration match a closed pattern before any path is built, links and special files are refused, free text is one
// printable line, and a file or row not in template shape stays byte-identical and comes back in `unwritten`. Writes are
// temp file + rename; time is the `now` parameter. Every writer returns { wrote: [paths relative to root], unwritten: [{
// file, reason, line }] } (a write-failed item also carries the errno `code`; a replayed diary entry adds `skipped:
// 'replay'`); a bad argument throws a usage error (64). Markdown safety rests on the callers: every title and body is
// built from enums, numbers and ids, never from a model's text (oneLine strips breaks and control characters, not markup).

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { KIND, usageError } from './loop-exit.mjs';
import { ITERATION_RE, SLUG_RE } from './run-card.mjs';
import { archiveHead, archiveShape, CATEGORIES, compactDiary, formatEntry, insertEntry, isReplay, isSummaryTitle } from './loop-notes-compact.mjs';

export { ITERATION_RE };
export const STATUSES = ['not-started', 'in-progress', 'done', 'blocked', 'superseded'];
const MAX_TEXT = 300;
// Every entry the writer makes ends with this line, so a reader can tell it from a person's. The writer authors neither
// decision-change nor plan-change: those are never compacted away, and only a person decides them.
const PROVENANCE = 'Written by the loop step engine; every field comes from stored loop state.';
const WRITABLE = CATEGORIES.filter((c) => c !== 'decision-change' && c !== 'plan-change');
const MAX_FILE = 4 * 1024 * 1024;
// Removed by Unicode property, so invisible code points (tags, variation selectors, fillers, bidi, zero-width) cannot pass.
// Exported: the one definition, the step kit (loop-step-kit.mjs) cleans what it echoes with it too (\u{2800}, the blank braille cell, is not default-ignorable).
export const CONTROL = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}\p{Variation_Selector}\u{2800}]/gu;
const BREAKS = /[\r\n\t\v\f\u{85}\u{2028}\u{2029}]+/gu;

// One printable line, at most 300 characters, that cannot open a heading. Throws on a non-string.
function oneLine(v, what) {
  if (typeof v !== 'string') throw usageError(`${what} must be a string`);
  const s = v.replace(BREAKS, ' ').replace(CONTROL, '').replace(/\s+/g, ' ').trim().replace(/^[#\s]+/, '');
  return [...s].slice(0, MAX_TEXT).join('').trim();
}
// A table cell additionally cannot carry a pipe, so it cannot add a column.
const cell = (v, what) => oneLine(v, what).replace(/\|/g, '');

// `now` must start with a real instant, YYYY-MM-DDTHH:MM, in 2000..2099 (a Date round-trip rejects 02-30 and 99:99).
function stampOf(now) {
  const minute = typeof now === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(now) ? now.slice(0, 16) : null;
  const at = minute && new Date(`${minute}:00Z`);
  if (!at || Number.isNaN(at.getTime()) || at.toISOString().slice(0, 16) !== minute || at.getUTCFullYear() < 2000 || at.getUTCFullYear() > 2099) throw usageError('now must be an ISO timestamp in 2000..2099');
  return { date: minute.slice(0, 10), stamp: minute.replace('T', ' ') };
}

// -> { dir } | { reason: 'missing' | 'unreadable' | 'not a plain directory' }. Every component of `parts` below `root` must
// be a real directory (a link is refused). Exported: the step kit and the review step walk the findings ledger's directory with it too.
export function plainDir(root, parts) {
  let dir = root;
  for (const part of parts) {
    try { if (!fs.lstatSync(dir = path.join(dir, part)).isDirectory()) return { reason: 'not a plain directory' }; } catch (e) { return { reason: e.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
  }
  return { dir };
}

// -> { dir, rel } | { refused }. The plan directory, below the (realpath-resolved) root, through plainDir.
function planDir({ root, slug }) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw usageError('slug must match ^[a-z0-9][a-z0-9-]{0,63}$');
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw usageError('root must be an absolute path');
  let real;
  try { real = fs.realpathSync(root); } catch { throw usageError('root is not readable'); }
  const walked = plainDir(real, ['.somi', 'plans', slug]);
  if (walked.reason) return { refused: walked.reason === 'not a plain directory' ? 'plan-dir-not-a-plain-directory' : 'plan-dir-missing' };
  return { dir: walked.dir, rel: `.somi/plans/${slug}` };
}

// -> { text, mode } | { reason }. A symlink, a non-file (refused before open: a FIFO would block it) and an oversized file are refused.
export function readPlanFile(file) {
  try {
    const l = fs.lstatSync(file);
    if (l.isSymbolicLink() || !l.isFile()) return { reason: l.isSymbolicLink() ? 'symlink' : 'not-a-regular-file' };
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0) | (fs.constants.O_NOCTTY ?? 0));
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > MAX_FILE) return { reason: st.isFile() ? 'too-large' : 'not-a-regular-file' };
      return { text: fs.readFileSync(fd, 'utf8'), mode: st.mode & 0o777 };
    } finally { fs.closeSync(fd); }
  } catch (e) { return { reason: e.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
}

// Temp file in the same directory, then rename: a crash leaves the old file or the new one, never half of either.
// A failed write (EACCES, ENOSPC, rename) removes its temp file and returns the errno code; null on success. It never throws.
function writeAtomic(file, text, mode = 0o644) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, text, { flag: 'wx', mode });
    fs.renameSync(tmp, file);
    return null;
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* the temp name is random; a leftover cannot be read as a plan file */ }
    return /^[A-Z0-9_]{1,32}$/.test(e?.code) ? e.code : 'UNKNOWN';
  }
}

// `kind` names the record the line summarises (diary-entry, iteration-row, last-activity), so the caller knows what to write where;
// an item that asks for no write (a refused move, a skipped compaction) has the kind `notice`.
const refusal = (file, reason, line, kind) => ({ wrote: [], unwritten: [{ file, reason, line, kind }] });
const writeFailed = (file, code, line, kind) => ({ file, reason: 'write-failed', code, line, kind });
// A diary with no entry yet: the title, then only blank, quoted (`> `) and `---` lines. The first entry goes after them.
const bareDiary = (text) => archiveShape(text) && text.split('\n').slice(1).every((l) => l.trim() === '' || l.startsWith('>') || l.trim() === '---');
const SKIPPED = 'compaction skipped; diary.md is over 40 entries';
const skipped = (reason, code) => ({ file: 'diary-archive.md', reason, ...(code ? { code } : {}), line: SKIPPED, kind: KIND.notice });

export function appendDiary(plan, entry) {
  const { stamp } = stampOf(entry.now);
  if (!WRITABLE.includes(entry.category)) throw usageError(`category must be one of ${WRITABLE.join('|')}`);
  const title = oneLine(entry.title, 'title');
  if (!/[\p{L}\p{N}]/u.test(title)) throw usageError('title must contain a letter or a digit');
  if (isSummaryTitle(title)) throw usageError('a title starting "Compacted:" is reserved for the compaction summary');
  const text = formatEntry({ stamp, title, category: entry.category, phase: oneLine(entry.phase ?? 'work-item-wide', 'phase') || 'work-item-wide', body: [oneLine(entry.body ?? '', 'body'), PROVENANCE].filter(Boolean).join('\n\n') });
  const line = [entry.category, title, oneLine(entry.body ?? '', 'body')].filter(Boolean).join(' — '); // what a caller reads: not the entry, whose stamp, markup and provenance it builds itself
  const p = planDir(plan);
  if (p.refused) return refusal('diary.md', p.refused, line, KIND.diaryEntry);
  const file = path.join(p.dir, 'diary.md');
  const cur = readPlanFile(file);
  const next = cur.text === undefined ? null : insertEntry(cur.text, text) ?? (bareDiary(cur.text) ? `${cur.text.replace(/\n*$/, '\n\n')}${text}` : null);
  if (next === null) return refusal('diary.md', cur.reason ?? 'not-template-shape', line, KIND.diaryEntry);
  if (isReplay(cur.text, text)) return { wrote: [], unwritten: [], skipped: 'replay' }; // a replayed step: this exact entry is already newest
  const wrote = []; const unwritten = [];
  let diary = next;
  const compacted = compactDiary(next, stamp);
  if (compacted) {
    const archiveFile = path.join(p.dir, 'diary-archive.md');
    const arch = readPlanFile(archiveFile);
    if (arch.reason === 'missing' || (arch.text !== undefined && archiveShape(arch.text))) {
      // The archive first: a crash between the two writes duplicates entries, it never loses any.
      const code = writeAtomic(archiveFile, (arch.text ?? archiveHead(plan.slug)).replace(/\n*$/, '\n\n') + compacted.archived, arch.mode);
      if (code) unwritten.push(skipped('write-failed', code));
      else {
        wrote.push(`${p.rel}/diary-archive.md`);
        diary = compacted.diary;
      }
    } else unwritten.push(skipped(arch.reason === 'too-large' ? 'archive-too-large' : arch.reason ?? 'not-template-shape'));
  }
  const failed = writeAtomic(file, diary, cur.mode);
  if (failed) return { wrote, unwritten: [...unwritten, writeFailed('diary.md', failed, line, KIND.diaryEntry)] };
  wrote.push(`${p.rel}/diary.md`);
  return { wrote, unwritten };
}

// Edit progress.md through `edit(text)` -> { text, notices? } (the new file; notices ride along as unwritten items) or { reason } (not in template shape: no write).
function editProgress(plan, edit, line, kind) {
  const p = planDir(plan);
  if (p.refused) return refusal('progress.md', p.refused, line, kind);
  const file = path.join(p.dir, 'progress.md');
  const cur = readPlanFile(file);
  const out = cur.text === undefined ? cur : archiveShape(cur.text) ? edit(cur.text) : { reason: 'not-template-shape' };
  if (out.text === undefined) return refusal('progress.md', out.reason, line, out.notice ? KIND.notice : kind);
  const failed = writeAtomic(file, out.text, cur.mode);
  if (failed) return { wrote: [], unwritten: [writeFailed('progress.md', failed, line, kind)] };
  return { wrote: [`${p.rel}/progress.md`], unwritten: out.notices ?? [] };
}

// The `## <title>` section: { start, end } (the heading's line and the next heading's, or the end), or null unless the
// heading is there exactly once and its section holds no code fence or `<!--`.
function sectionOf(lines, title) {
  const at = lines.flatMap((l, i) => (l === `## ${title}` ? [i] : []));
  if (at.length !== 1) return null;
  const stop = lines.findIndex((l, i) => i > at[0] && /^#{1,6}\s/.test(l));
  const end = stop < 0 ? lines.length : stop;
  return lines.slice(at[0] + 1, end).some((l) => /^\s*(```|~~~)|<!--/.test(l)) ? null : { start: at[0], end };
}

const splitRow = (l) => (l.startsWith('|') && l.endsWith('|') ? l.slice(1, -1).split('|') : null);
const HEADER = ['Iteration', null, 'Status', 'Reviewed', 'Last activity'];

// The one reader of the `| N.M |` row, for markIteration and for `open`: the file is in template shape (a `# ` title
// first, no CR), the `## Iteration progress` heading is there exactly once, its section (which ends at the next heading
// of any level) holds no code fence or `<!--`, the template header and its separator open it, and the row exists once
// with five cells. With `loose` the header need not be the template's: it must start with Iteration, name a Status column,
// and the row must have as many cells as the header; Reviewed and Last activity are used where the header has them.
// -> { lines, index, cells, cols } (the column of each cell, -1 where the table has none) | { reason: 'not-template-shape' |
// 'row-not-template-shape' | 'missing' | 'ambiguous', why? } where `why` names the condition that failed (for a person;
// nothing branches on it).
export function findIterationRow(text, iteration, loose = false) {
  const lines = text.split('\n');
  const at = lines.flatMap((l, i) => (l === '## Iteration progress' ? [i] : []));
  const shape = (why) => ({ reason: 'not-template-shape', why });
  if (!archiveShape(text)) return shape('the file does not start with a "# " title, or holds a carriage return');
  if (at.length !== 1) return shape(`the "## Iteration progress" heading appears ${at.length} times, not once`);
  const start = at[0];
  const stop = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l));
  if (lines.slice(start + 1, stop < 0 ? undefined : stop).some((l) => /^\s*(```|~~~)|<!--/.test(l))) return shape('the section holds a code fence or <!--');
  const rows = lines.flatMap((l, i) => (i > start && (stop < 0 || i < stop) && l.startsWith('|') ? [i] : []));
  const head = rows.length >= 2 ? splitRow(lines[rows[0]]) : null;
  const names = head?.map((h) => h.trim());
  const template = head?.length === 5 && HEADER.every((h, i) => !h || names[i] === h);
  const lenient = loose && names?.[0] === 'Iteration' && names.includes('Status');
  if (!head || !/^\|[-| :]+\|$/.test(lines[rows[1]]) || !(template || lenient)) return shape('the table header or its separator row is not the template\'s');
  const cols = template ? { status: 2, reviewed: 3, activity: 4 } : { status: names.indexOf('Status'), reviewed: names.indexOf('Reviewed'), activity: names.indexOf('Last activity') };
  const hits = rows.slice(2).filter((i) => splitRow(lines[i])?.[0].trim() === iteration);
  if (hits.length !== 1) return { reason: hits.length === 0 ? 'missing' : 'ambiguous' };
  const cells = splitRow(lines[hits[0]]);
  return cells.length === head.length ? { lines, index: hits[0], cells, cols } : { reason: 'row-not-template-shape' };
}

// Set phase N's `a/b` cell of the `## Phase progress` table (column named `Iterations done / total`, row whose first cell is
// N) to the number of the iteration table's `N.*` rows that are done, keeping the total and the cell's width. Edits `lines`.
// -> [] (also when the table, the column, the row or an `a/b` cell is absent: nothing to keep in step) | [a notice
// item] when the count is above the total, in which case the cell is left as it was.
function setPhaseDone(lines, index, cols, iteration, line) {
  const phase = iteration.split('.')[0];
  const sec = sectionOf(lines, 'Phase progress');
  if (!sec) return [];
  let top = lines.findIndex((l, i) => i > sec.start && i < sec.end && l.startsWith('|')); // the table is the run of `|` lines from the first
  if (top < 0) return [];
  const rows = [];
  while (top < sec.end && lines[top].startsWith('|')) rows.push(top++);
  const names = rows.length >= 2 && /^\|[-| :]+\|$/.test(lines[rows[1]]) ? splitRow(lines[rows[0]])?.map((h) => h.trim()) : null;
  const col = names ? names.indexOf('Iterations done / total') : -1;
  const hits = col < 0 ? [] : rows.slice(2).filter((i) => splitRow(lines[i])?.[0].trim() === phase);
  const cells = hits.length === 1 ? splitRow(lines[hits[0]]) : null;
  const m = names && cells?.length === names.length ? /^(\s*)(\d{1,4})\/(\d{1,4})(\s*)$/.exec(cells[col]) : null;
  if (!m) return [];
  let first = index; let last = index; // the iteration table is the run of table lines around the row
  while (lines[first - 1]?.startsWith('|')) first--;
  while (lines[last + 1]?.startsWith('|')) last++;
  // the marked row's width (findIterationRow proved it equals the header's): a row of another width is not counted, a repeated id counts once
  const width = splitRow(lines[index]).length;
  const done = new Set(lines.slice(first, last + 1).flatMap((l) => { const c = splitRow(l); return c?.length === width && c[0].trim().startsWith(`${phase}.`) && c[cols.status]?.trim() === 'done' ? [c[0].trim()] : []; })).size;
  if (done > Number(m[3])) return [{ file: 'progress.md', reason: 'count-above-total', line: `phase ${phase}: ${done} iterations done, total ${m[3]}; ${line}`, kind: KIND.notice }];
  if (done !== Number(m[2])) {
    cells[col] = `${m[1]}${done}/${m[3]}`.padEnd(cells[col].length);
    lines[hits[0]] = `|${cells.join('|')}|`;
  }
  return [];
}

// The moves of a Status cell (a rewrite of the same status is always allowed). Nothing leaves done or superseded, and
// superseded is set by a human editing the plan, never by this writer.
const MOVES = { 'not-started': ['in-progress'], 'in-progress': ['done', 'blocked'], blocked: ['in-progress'] };

// Change Status, Reviewed and Last activity of the `| N.M |` row (the template's columns 3 to 5, or the ones a table with
// another header has), keeping the other cells and the column widths. The row must exist once with as many cells as its
// header, and a Status change must be one of MOVES (else `transition-refused`, nothing written). In the same write the
// phase's done count is brought in step with the table (setPhaseDone).
export function markIteration(plan, iteration, { status, reviewed, activity, now }) {
  if (typeof iteration !== 'string' || !ITERATION_RE.test(iteration)) throw usageError('iteration must look like 1.2');
  const { date } = stampOf(now);
  if (status !== undefined && !STATUSES.includes(status)) throw usageError(`status must be one of ${STATUSES.join('|')}`);
  const patch = { status, reviewed: reviewed === undefined ? undefined : cell(reviewed, 'reviewed'), activity: activity === undefined ? date : `${date} — ${cell(activity, 'activity')}` };
  const line = `iteration ${iteration}: Status=${patch.status ?? '(unchanged)'}, Reviewed=${patch.reviewed ?? '(unchanged)'}, Last activity=${patch.activity}`;
  return editProgress(plan, (text) => {
    const found = findIterationRow(text, iteration, true);
    if (!found.lines) return { reason: { missing: 'row-missing', ambiguous: 'row-ambiguous' }[found.reason] ?? found.reason };
    const { lines, index, cells, cols } = found;
    const was = cells[cols.status].trim();
    if (status !== undefined && status !== was && !(Object.hasOwn(MOVES, was) && MOVES[was].includes(status))) return { reason: 'transition-refused', notice: true };
    for (const field of Object.keys(patch)) if (patch[field] !== undefined && cols[field] >= 0) cells[cols[field]] = ` ${patch[field]} `.padEnd(cells[cols[field]].length); // a column the table lacks is skipped
    lines[index] = `|${cells.join('|')}|`;
    const notices = setPhaseDone(lines, index, cols, iteration, line);
    return { text: lines.join('\n'), notices };
  }, line, KIND.iterationRow);
}

export function setLastActivity(plan, { activity, now }) {
  const { date } = stampOf(now);
  const value = `**Last activity**: ${date} — ${oneLine(activity, 'activity')}`;
  return editProgress(plan, (text) => {
    const lines = text.split('\n');
    const hits = lines.flatMap((l, i) => (l.startsWith('**Last activity**: ') ? [i] : []));
    if (hits.length > 1) return { reason: 'row-ambiguous' };
    if (hits.length === 1) lines[hits[0]] = value;
    else { // no line yet: it goes after the last line of `## Status`, set off by a blank line unless that is a `**key**: ` line
      const sec = sectionOf(lines, 'Status');
      if (!sec) return { reason: 'line-missing' };
      if (lines.slice(sec.start, sec.end).some((l) => /^[\W_]*last activity(?![a-z0-9])/i.test(l))) return { reason: 'row-ambiguous' }; // the line is there in another spelling
      let last = sec.end - 1;
      while (lines[last].trim() === '') last--;
      lines.splice(last + 1, 0, ...(/^\*\*[^*]+\*\*: /.test(lines[last]) ? [] : ['']), value);
    }
    return { text: lines.join('\n') };
  }, value, KIND.lastActivity);
}
