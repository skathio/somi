// loop-notes.mjs -- the loop's two narrow writers into a work item (the tool writes only these): a diary entry at the
// top of diary.md (40/15 compaction into diary-archive.md), and in progress.md only the `| N.M |` row of the iteration
// table and the `**Last activity**` line. Writes are confined to <root>/.somi/plans/<slug>/: slug and iteration match a
// closed pattern before any path is built, links and special files are refused, free text is one printable line, and
// a file or row not in template shape stays byte-identical and comes back in `unwritten`. Writes are temp file +
// rename; time is the `now` parameter. Every writer returns { wrote: [paths relative to root], unwritten: [{ file,
// reason, line }] } (a write-failed item also carries the errno `code`; a replayed diary entry adds `skipped:
// 'replay'`); a bad argument throws a usage error (64).

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { usageError } from './loop-exit.mjs';
import { SLUG_RE } from './run-card.mjs';
import { archiveHead, archiveShape, CATEGORIES, compactDiary, formatEntry, insertEntry, isReplay, isSummaryTitle } from './loop-notes-compact.mjs';

export const ITERATION_RE = /^\d+\.\d+[a-z]?$/;
export const STATUSES = ['not-started', 'in-progress', 'done', 'blocked', 'superseded'];
const MAX_TEXT = 300;
const MAX_FILE = 4 * 1024 * 1024;
// Removed by Unicode property, so invisible code points (tags, variation selectors, fillers, bidi, zero-width) cannot pass.
const CONTROL = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}\p{Variation_Selector}]/gu;
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

// -> { dir, rel } | { refused }. Every component below the (realpath-resolved) root must be a real directory.
function planDir({ root, slug }) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw usageError('slug must match ^[a-z0-9][a-z0-9-]{0,63}$');
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw usageError('root must be an absolute path');
  let dir;
  try { dir = fs.realpathSync(root); } catch { throw usageError('root is not readable'); }
  for (const part of ['.somi', 'plans', slug]) {
    dir = path.join(dir, part);
    let st;
    try { st = fs.lstatSync(dir); } catch { return { refused: 'plan-dir-missing' }; }
    if (st.isSymbolicLink() || !st.isDirectory()) return { refused: 'plan-dir-not-a-plain-directory' };
  }
  return { dir, rel: `.somi/plans/${slug}` };
}

// -> { text, mode } | { reason }. A symlink, a non-file (refused before open: a FIFO would block it) and an oversized file are refused.
function readPlanFile(file) {
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

const refusal = (file, reason, line) => ({ wrote: [], unwritten: [{ file, reason, line }] });
const writeFailed = (file, code, line) => ({ file, reason: 'write-failed', code, line });
const SKIPPED = 'compaction skipped; diary.md is over 40 entries';

export function appendDiary(plan, entry) {
  const { stamp } = stampOf(entry.now);
  if (!CATEGORIES.includes(entry.category)) throw usageError(`category must be one of ${CATEGORIES.join('|')}`);
  const title = oneLine(entry.title, 'title');
  if (!/[\p{L}\p{N}]/u.test(title)) throw usageError('title must contain a letter or a digit');
  if (isSummaryTitle(title)) throw usageError('a title starting "Compacted:" is reserved for the compaction summary');
  const text = formatEntry({ stamp, title, category: entry.category, phase: oneLine(entry.phase ?? 'work-item-wide', 'phase') || 'work-item-wide', body: oneLine(entry.body ?? '', 'body') });
  const line = text.replace(/\n*---\n*$/, '');
  const p = planDir(plan);
  if (p.refused) return refusal('diary.md', p.refused, line);
  const file = path.join(p.dir, 'diary.md');
  const cur = readPlanFile(file);
  const next = cur.text === undefined ? null : insertEntry(cur.text, text);
  if (next === null) return refusal('diary.md', cur.reason ?? 'not-template-shape', line);
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
      if (code) unwritten.push(writeFailed('diary-archive.md', code, SKIPPED));
      else {
        wrote.push(`${p.rel}/diary-archive.md`);
        diary = compacted.diary;
      }
    } else unwritten.push({ file: 'diary-archive.md', reason: arch.reason === 'too-large' ? 'archive-too-large' : arch.reason ?? 'not-template-shape', line: SKIPPED });
  }
  const failed = writeAtomic(file, diary, cur.mode);
  if (failed) return { wrote, unwritten: [...unwritten, writeFailed('diary.md', failed, line)] };
  wrote.push(`${p.rel}/diary.md`);
  return { wrote, unwritten };
}

// Edit progress.md through `edit(text)` -> { text } (the new file) or { reason } (not in template shape: no write).
function editProgress(plan, edit, line) {
  const p = planDir(plan);
  if (p.refused) return refusal('progress.md', p.refused, line);
  const file = path.join(p.dir, 'progress.md');
  const cur = readPlanFile(file);
  const out = cur.text === undefined ? cur : archiveShape(cur.text) ? edit(cur.text) : { reason: 'not-template-shape' };
  if (out.text === undefined) return refusal('progress.md', out.reason, line);
  const failed = writeAtomic(file, out.text, cur.mode);
  if (failed) return { wrote: [], unwritten: [writeFailed('progress.md', failed, line)] };
  return { wrote: [`${p.rel}/progress.md`], unwritten: [] };
}

const splitRow = (l) => (l.startsWith('|') && l.endsWith('|') ? l.slice(1, -1).split('|') : null);
const HEADER = ['Iteration', null, 'Status', 'Reviewed', 'Last activity'];

// Change Status (col 3), Reviewed (col 4) and Last activity (col 5) of the `| N.M |` row, keeping Title and the
// column widths. The row must exist once, with exactly the five columns of the template's table.
export function markIteration(plan, iteration, { status, reviewed, activity, now }) {
  if (typeof iteration !== 'string' || !ITERATION_RE.test(iteration)) throw usageError('iteration must look like 1.2');
  const { date } = stampOf(now);
  if (status !== undefined && !STATUSES.includes(status)) throw usageError(`status must be one of ${STATUSES.join('|')}`);
  const patch = { 2: status, 3: reviewed === undefined ? undefined : cell(reviewed, 'reviewed'), 4: activity === undefined ? date : `${date} — ${cell(activity, 'activity')}` };
  const line = `iteration ${iteration}: Status=${patch[2] ?? '(unchanged)'}, Reviewed=${patch[3] ?? '(unchanged)'}, Last activity=${patch[4]}`;
  return editProgress(plan, (text) => {
    const lines = text.split('\n');
    const start = lines.indexOf('## Iteration progress');
    if (start < 0) return { reason: 'not-template-shape' };
    const stop = lines.findIndex((l, i) => i > start && l.startsWith('## '));
    const rows = lines.flatMap((l, i) => (i > start && (stop < 0 || i < stop) && l.startsWith('|') ? [i] : []));
    const head = rows.length >= 2 ? splitRow(lines[rows[0]]) : null;
    if (!head || head.length !== 5 || HEADER.some((h, i) => h && head[i].trim() !== h) || !/^\|[-| :]+\|$/.test(lines[rows[1]])) return { reason: 'not-template-shape' };
    const hits = rows.slice(2).filter((i) => splitRow(lines[i])?.[0].trim() === iteration);
    if (hits.length !== 1) return { reason: hits.length === 0 ? 'row-missing' : 'row-ambiguous' };
    const cells = splitRow(lines[hits[0]]);
    if (cells.length !== 5) return { reason: 'row-not-template-shape' };
    for (const i of [2, 3, 4]) if (patch[i] !== undefined) cells[i] = ` ${patch[i]} `.padEnd(cells[i].length);
    lines[hits[0]] = `|${cells.join('|')}|`;
    return { text: lines.join('\n') };
  }, line);
}

export function setLastActivity(plan, { activity, now }) {
  const { date } = stampOf(now);
  const value = `**Last activity**: ${date} — ${oneLine(activity, 'activity')}`;
  return editProgress(plan, (text) => {
    const lines = text.split('\n');
    const hits = lines.flatMap((l, i) => (l.startsWith('**Last activity**: ') ? [i] : []));
    if (hits.length !== 1) return { reason: hits.length === 0 ? 'row-missing' : 'row-ambiguous' };
    lines[hits[0]] = value;
    return { text: lines.join('\n') };
  }, value);
}
