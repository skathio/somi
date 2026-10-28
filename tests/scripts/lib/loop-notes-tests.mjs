#!/usr/bin/env node
// Tests of the diary and progress writers (loop-notes.mjs, loop-notes-compact.mjs). The risk is the write path, so the
// threat cases list every file under the temp tree, links included, before and after. Run by tests/scripts/loop-engine.sh.

import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { appendDiary, markIteration, setLastActivity } from '../../../scripts/lib/loop-notes.mjs';
import { LoopExit } from '../../../scripts/lib/loop-exit.mjs';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'lib');
let pass = 0; let fail = 0; let n = 0;
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};
const exitOf = (fn) => { try { fn(); } catch (e) { return [e instanceof LoopExit, e.code]; } return 'no throw'; };

const base = mkdtempSync(path.join(tmpdir(), 'loop-notes-'));
const NOW = '2026-10-29T09:30:00Z';
const PRE = '# Diary — p1\n\n> Spec: x\n\nPreamble.\n\n---\n\n';
const entry = (n, cat = 'note') => `## 2026-01-${String((n % 28) + 1).padStart(2, '0')} 10:00 — ${n === 27 ? 'Compacted: earlier' : `entry ${n}`}\n\n${cat === null ? 'no category line\n' : `**Category**: \`${cat}\`\n**Phase**: 1\n`}\nbody ${n}\n\n---\n\n`;
const diaryOf = (n, special = {}) => PRE + Array.from({ length: n }, (_, i) => entry(i + 1, special[i + 1])).join('');
const PROGRESS = '# Progress — p1\n\n## Status\n\n`in-progress`\n\n**Started**: 2026-10-28\n**Last activity**: 2026-10-28 — start\n\n## Iteration progress\n\n| Iteration | Title   | Status      | Reviewed | Last activity |\n|-----------|---------|-------------|----------|---------------|\n| 1.1       | First   | done        | approve  | 2026-10-28    |\n| 2.1       | Writers | not-started | —        | —             |\n\n## Follow-ups\n\n- [ ] a | b\n';
// A fresh root with .somi/plans/p1/{diary.md,progress.md}.
function fresh({ diary = diaryOf(2), progress = PROGRESS } = {}) {
  const root = path.join(base, `case${n++}`); const dir = path.join(root, '.somi', 'plans', 'p1');
  mkdirSync(dir, { recursive: true });
  if (diary !== null) writeFileSync(path.join(dir, 'diary.md'), diary);
  if (progress !== null) writeFileSync(path.join(dir, 'progress.md'), progress);
  return { root, dir, plan: { root, slug: 'p1' } };
}
const read = (f) => readFileSync(f, 'utf8');
const headings = (t) => t.split('\n').filter((l) => l.startsWith('## ')).length;
// Every path under `dir` with its content hash (or link target): the "nothing else was written" oracle.
const snap = (dir) => Object.fromEntries(readdirSync(dir, { recursive: true }).sort().map((rel) => {
  const f = path.join(dir, rel); const st = lstatSync(f);
  return [rel, st.isSymbolicLink() ? `link->${readlinkSync(f)}` : st.isDirectory() ? 'dir' : !st.isFile() ? 'special' : createHash('sha256').update(readFileSync(f)).digest('hex')];
}));
// Bidi override, zero-width space, soft hyphen, tag characters (spelling "AB"), variation selectors, fillers: built from code points.
const INVISIBLE = String.fromCodePoint(0x202e, 0x200b, 0xad, 0x34f, 0xe0041, 0xe0042, 0xfe0f, 0xe0100, 0x3164, 0xffa0, 0x180e);
const note = (over = {}) => ({ category: 'note', phase: '2', title: 'Writers done', body: 'two writers', now: NOW, ...over });

console.log('== loop notes: no environment, no process ==');
for (const f of ['loop-notes.mjs', 'loop-notes-compact.mjs']) {
  const code = read(path.join(LIB, f)).split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  check(`${f} names neither process nor globalThis outside comments`, /\b(process|globalThis)\b/.test(code), false);
}
const { plan: p0 } = fresh();
check('a missing or malformed now is refused with 64 before any read', [exitOf(() => appendDiary(p0, note({ now: undefined }))), exitOf(() => appendDiary(p0, note({ now: 'yesterday' })))], [[true, 64], [true, 64]]);
check('a now that is not a real instant in 2000..2099 is refused with 64 by every writer', ['9999-99-99T99:99', '2026-02-30T10:00', '2026-10-29T24:00', '1999-12-31T23:59', '2100-01-01T00:00'].flatMap((now) => [exitOf(() => appendDiary(p0, note({ now }))), exitOf(() => setLastActivity(p0, { activity: 'x', now }))]), Array(10).fill([true, 64]));
console.log('== appendDiary: the entry and its place ==');
{
  const { plan, dir } = fresh();
  const before = read(path.join(dir, 'diary.md'));
  const r = appendDiary(plan, note());
  const after = read(path.join(dir, 'diary.md'));
  const want = `## 2026-10-29 09:30 — Writers done\n\n**Category**: \`note\`\n**Phase**: 2\n\ntwo writers\n\n---\n\n`;
  check('the entry lands newest first, right after the preamble, in template shape', after, PRE + want + before.slice(PRE.length));
  check('it reports the one path it wrote and nothing unwritten', r, { wrote: ['.somi/plans/p1/diary.md'], unwritten: [] });
  check('a category outside the closed list, an empty title and a title with no letter or digit are refused with 64', [exitOf(() => appendDiary(plan, note({ category: 'chat' }))), exitOf(() => appendDiary(plan, note({ title: '###' }))), exitOf(() => appendDiary(plan, note({ title: `!! ${INVISIBLE} --` })))], [[true, 64], [true, 64], [true, 64]]);
  check('a title that reads as the compaction summary is refused with 64; one that merely contains the word is not', [exitOf(() => appendDiary(plan, note({ title: 'Compacted: 2026-01-01 .. 2026-01-02' }))), exitOf(() => appendDiary(plan, note({ title: '  ### compacted : x' }))), exitOf(() => appendDiary(plan, note({ title: 'Re: Compacted: x' })))], [[true, 64], [true, 64], 'no throw']);
}
console.log('== appendDiary: a replayed entry is written once ==');
{
  const { plan, dir } = fresh();
  const f = path.join(dir, 'diary.md');
  appendDiary(plan, note());
  const once = read(f);
  const again = appendDiary(plan, note());
  check('an entry identical to the newest one writes nothing and says so: wrote [], no unwritten, skipped replay', [again, read(f)], [{ wrote: [], unwritten: [], skipped: 'replay' }, once]);
  appendDiary(plan, note({ category: 'discovery' }));
  appendDiary(plan, note({ title: 'Other title' }));
  appendDiary(plan, note({ now: '2026-10-29T09:31:00Z' }));
  appendDiary(plan, note({ body: 'other body, same stamp, title, category and phase' }));
  appendDiary(plan, note({ body: 'other body, same stamp, title, category and phase', phase: '3' }));
  check('a different category, title, minute, body or phase is a new entry', headings(read(f)) - headings(once), 5);
  appendDiary(plan, note({ title: 'Writers done' }));
  appendDiary(plan, note({ title: 'Writers done' }));
  check('only the newest entry counts: an older entry repeated is written once more, then its immediate repeat is not', headings(read(f)) - headings(once), 6);
}
console.log('== appendDiary: the 40/15 compaction ==');
{
  const { plan, dir } = fresh({ diary: diaryOf(41, { 20: 'decision-change', 30: 'plan-change', 25: 'review-feedback', 35: null }) });
  const before = read(path.join(dir, 'diary.md'));
  const r = appendDiary(plan, note({ title: 'N' }));
  const diary = read(path.join(dir, 'diary.md')); const archive = read(path.join(dir, 'diary-archive.md'));
  const moved = [];
  for (let k = 15; k <= 41; k++) if (![20, 27, 30, 35].includes(k)) moved.push(entry(k, k === 25 ? 'review-feedback' : 'note'));
  check('41 entries gain one (42) and compact to 15 newest + 3 that must stay + an earlier Compacted entry + the new one', headings(diary), 20);
  check('the moved entries are the movable ones older than the newest 15, verbatim, newest first, at the end of the archive', archive.endsWith(moved.join('')), true);
  check('decision-change, plan-change, an earlier Compacted entry and an entry with no readable category stay in diary.md', [20, 30, 35, 27].map((k) => diary.includes(entry(k, k === 20 ? 'decision-change' : k === 30 ? 'plan-change' : k === 27 ? 'note' : null))), [true, true, true, true]);
  check('one Compacted entry names the span and the count, in place of the newest moved entry', /## 2026-10-29 09:30 — Compacted: 2026-01-\d\d \.\. 2026-01-\d\d\n/.test(diary) && diary.includes('23 older entries moved verbatim') && diary.indexOf('entry 14\n') < diary.indexOf('Compacted:') && diary.indexOf('Compacted:') < diary.indexOf('entry 20\n'), true);
  check('both files are reported as written; the archive got a head', [r.wrote, archive.startsWith('# Diary archive — p1\n\n')], [['.somi/plans/p1/diary-archive.md', '.somi/plans/p1/diary.md'], true]);
  check('every original entry survives, in the diary or the archive', [...before.matchAll(/body (\d+)/g)].every((m) => (diary + archive).includes(`body ${m[1]}\n`)), true);
}
{
  const old = '# Diary archive — p1\n\n## 2025-12-01 10:00 — old\n\n**Category**: `note`\n\nold body\n\n---\n\n';
  const { plan, dir } = fresh({ diary: diaryOf(40) });
  writeFileSync(path.join(dir, 'diary-archive.md'), old);
  appendDiary(plan, note());
  const archive = read(path.join(dir, 'diary-archive.md'));
  check('an existing archive keeps its entries and gains the moved ones after them (40 + 1 compacts)', [archive.startsWith(old), headings(archive), headings(read(path.join(dir, 'diary.md')))], [true, 1 + 25, 17]);
  const small = fresh({ diary: diaryOf(39) });
  appendDiary(small.plan, note());
  check('39 + 1 = 40 entries do not compact: no archive file', [headings(read(path.join(small.dir, 'diary.md'))), existsSync(path.join(small.dir, 'diary-archive.md'))], [40, false]);
}
// The Compacted entries in a diary as [title, count]; the fixture's hand-made 'Compacted: earlier' is not one of ours.
const SUMMARY = /^## [\d-]+ [\d:]+ — (Compacted: \d{4}-\d\d-\d\d \.\. \d{4}-\d\d-\d\d)\n\n\*\*Category\*\*: `note`\n\*\*Phase\*\*: work-item-wide\n\n(\d+) older entries moved verbatim/gm;
const summaries = (diary) => [...diary.matchAll(SUMMARY)].map((m) => [m[1], Number(m[2])]);
const running = (count, extra = '') => `## 2026-01-04 10:00 — Compacted: 2025-12-01 .. 2025-12-31\n\n**Category**: \`note\`\n**Phase**: work-item-wide\n\n${count} older entries moved verbatim to [\`diary-archive.md\`](./diary-archive.md); decision-change and plan-change entries stay here.\n${extra}\n---\n\n`;
{
  // 30 decision-change entries never move, so notes appended one after another are compacted several times.
  const dc = {}; for (let k = 12; k <= 41; k++) dc[k] = 'decision-change';
  const { plan, dir } = fresh({ diary: diaryOf(41, dc) });
  const rs = Array.from({ length: 8 }, (_, i) => appendDiary(plan, note({ title: `append ${i}`, now: `2026-10-29T09:${String(10 + i)}:00Z` })));
  const diary = read(path.join(dir, 'diary.md')); const archive = existsSync(path.join(dir, 'diary-archive.md')) ? read(path.join(dir, 'diary-archive.md')) : '';
  const ours = summaries(diary);
  check('8 appends compacted more than once, and the diary holds exactly one Compacted entry whose count is the number archived', [rs.filter((r) => r.wrote.length === 2).length > 1, ours.length, ours[0]?.[1] === headings(archive), ours[0]?.[1] > 0], [true, 1, true, true]);
}
{
  const { plan, dir } = fresh({ diary: diaryOf(41).replace(entry(3), running(7)) });
  appendDiary(plan, note({ title: 'N' }));
  const diary = read(path.join(dir, 'diary.md'));
  check('an earlier Compacted entry is replaced in place: span widened, count summed (7 + 26), still one', [summaries(diary), diary.indexOf('entry 2\n') < diary.indexOf('Compacted:') && diary.indexOf('Compacted:') < diary.indexOf('entry 4\n')], [[['Compacted: 2025-12-01 .. 2026-01-27', 33]], true]);
}
{
  const { plan, dir } = fresh({ diary: diaryOf(41).replace(entry(20), running(7)) });
  appendDiary(plan, note({ title: 'N' }));
  const diary = read(path.join(dir, 'diary.md'));
  check('a prior summary in the older region merges too: one summary, 7 + 25, and the archive holds the 25 moved entries', [summaries(diary), headings(read(path.join(dir, 'diary-archive.md')))], [[['Compacted: 2025-12-01 .. 2026-01-27', 32]], 25]);
}
{
  // Entries that only look like our summary are not ours: they stay byte for byte, and never become the running summary.
  const forged = running(7).replace('`note`', '`decision-change`');
  const huge = running('99999999999999999999');
  const extra = running(7, '\nand an extra line\n');
  const otherPhase = running(7).replace('work-item-wide', '2');
  for (const [name, planted] of Object.entries({ 'a decision-change entry titled Compacted': forged, 'a summary with a 20-digit count': huge, 'a summary with an extra line': extra, 'a summary in another phase': otherPhase, 'a summary with text after its closing rule': `${running(7)}trailing text\n\n` })) {
    const { plan, dir } = fresh({ diary: diaryOf(41).replace(entry(3), planted) });
    appendDiary(plan, note({ title: 'N' }));
    const diary = read(path.join(dir, 'diary.md'));
    check(`${name} is left byte for byte in diary.md; our summary counts only the 26 moved entries and sits elsewhere`, [diary.includes(planted), summaries(diary).filter(([t]) => !t.endsWith('2025-12-31')), headings(read(path.join(dir, 'diary-archive.md')))], [true, [['Compacted: 2026-01-01 .. 2026-01-27', 26]], 26]);
  }
  const dc = {}; for (let k = 12; k <= 41; k++) dc[k] = 'decision-change';
  const { plan, dir } = fresh({ diary: diaryOf(41, dc).replace(entry(3), huge) });
  for (let i = 0; i < 8; i++) appendDiary(plan, note({ title: `append ${i}`, now: `2026-10-29T09:${String(10 + i)}:00Z` }));
  const diary = read(path.join(dir, 'diary.md'));
  check('an oversized count does not breed a second summary: later compactions keep merging into one of ours', [diary.includes(huge), summaries(diary).filter(([t]) => !t.endsWith('2025-12-31')).length], [true, 1]);
}
console.log('== size caps: an oversized diary or archive is reported, never read ==');
{
  const cap = 4 * 1024 * 1024 + 1;
  const big = fresh();
  const bigDiary = path.join(big.dir, 'diary.md'); truncateSync(bigDiary, cap);
  const b = snap(big.root);
  const r = appendDiary(big.plan, note());
  check('a diary over 4 MiB is left alone and reported too-large with the entry text', [r.wrote, r.unwritten.map((u) => [u.file, u.reason, u.line.startsWith('## 2026-10-29 09:30 — Writers done')]), snap(big.root)], [[], [['diary.md', 'too-large', true]], b]);
  const { plan, dir } = fresh({ diary: diaryOf(41) });
  const archiveFile = path.join(dir, 'diary-archive.md'); writeFileSync(archiveFile, ''); truncateSync(archiveFile, cap);
  const first = appendDiary(plan, note({ title: 'one' }));
  const second = appendDiary(plan, note({ title: 'two' }));
  check('an archive over 4 MiB: the entry is still written uncompacted, archive-too-large comes back on every call, the archive is untouched', [first.wrote, second.wrote, [first, second].map((x) => x.unwritten.map((u) => [u.file, u.reason])), headings(read(path.join(dir, 'diary.md'))), statSync(archiveFile).size], [['.somi/plans/p1/diary.md'], ['.somi/plans/p1/diary.md'], Array(2).fill([['diary-archive.md', 'archive-too-large']]), 43, cap]);
}
console.log('== progress writers: the row and the line, nothing else ==');
{
  const { plan, dir } = fresh();
  const f = path.join(dir, 'progress.md');
  markIteration(plan, '2.1', { status: 'done', reviewed: 'approve', activity: 'writers', now: NOW });
  check('only the 2.1 row changes: title kept, columns padded as before', read(f), PROGRESS.replace('| 2.1       | Writers | not-started | —        | —             |', '| 2.1       | Writers | done        | approve  | 2026-10-29 — writers |'));
  setLastActivity(plan, { activity: 'iteration 2.1 done', now: NOW });
  check('setLastActivity changes only the Last activity line', read(f), PROGRESS.replace('| 2.1       | Writers | not-started | —        | —             |', '| 2.1       | Writers | done        | approve  | 2026-10-29 — writers |').replace('**Last activity**: 2026-10-28 — start', '**Last activity**: 2026-10-29 — iteration 2.1 done'));
  check('a status outside the closed list, an empty patch and a bad iteration are refused with 64', [exitOf(() => markIteration(plan, '2.1', { status: 'finished', now: NOW })), exitOf(() => markIteration(plan, '2.1', { status: 'done', now: undefined })), exitOf(() => markIteration(plan, '2', { status: 'done', now: NOW }))], [[true, 64], [true, 64], [true, 64]]);
}
{
  const bad = {
    'a missing row': [PROGRESS.replace(/\| 2\.1 .*\n/, ''), 'row-missing'],
    'a row with an extra column': [PROGRESS.replace('| not-started | —        | —             |', '| not-started | — | — | extra |'), 'row-not-template-shape'],
    'a duplicated row': [PROGRESS.replace('| 1.1       | First', '| 2.1       | Dup     | done        | x        | y             |\n| 1.1       | First'), 'row-ambiguous'],
    'a table without the template header': [PROGRESS.replace('| Reviewed |', '| Verdict  |'), 'not-template-shape'],
  };
  for (const [name, [text, reason]] of Object.entries(bad)) {
    const { plan, root } = fresh({ progress: text });
    const before = snap(root);
    const r = markIteration(plan, '2.1', { status: 'done', reviewed: 'approve', now: NOW });
    check(`${name}: nothing is written and the row text comes back (${reason})`, [snap(root), r.wrote, r.unwritten.map((u) => [u.file, u.reason, u.line])], [before, [], [['progress.md', reason, 'iteration 2.1: Status=done, Reviewed=approve, Last activity=2026-10-29']]]);
  }
  const noLine = fresh({ progress: PROGRESS.replace(/\*\*Last activity\*\*.*\n/, '') });
  const before = snap(noLine.root);
  const r = setLastActivity(noLine.plan, { activity: 'x', now: NOW });
  check('a progress file without the Last activity line is left alone and the line comes back', [snap(noLine.root), r.unwritten], [before, [{ file: 'progress.md', reason: 'row-missing', line: '**Last activity**: 2026-10-29 — x' }]]);
}
console.log('== free text cannot forge a heading, a row or a control sequence ==');
{
  const { plan, dir } = fresh();
  const headingsBefore = headings(read(path.join(dir, 'diary.md')));
  appendDiary(plan, note({ title: `## fake${INVISIBLE} title`, body: `## injected\nline2\r\n### h3\t${INVISIBLE}\u0007end` }));
  const diary = read(path.join(dir, 'diary.md'));
  check('a note "## injected\\nline2" adds exactly one heading and no line of its own', [headings(diary), diary.includes('\n## injected'), diary.includes('injected line2 ### h3 end\n')], [headingsBefore + 1, false, true]);
  check('control, bidi, zero-width, tag and other default-ignorable characters never reach the file; the visible title does', [/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(diary) || [...INVISIBLE].some((c) => diary.includes(c)), diary.includes('— fake title\n')], [false, true]);
  appendDiary(plan, note({ body: 'x'.repeat(500) }));
  check('free text is capped at 300 characters', read(path.join(dir, 'diary.md')).split('\n').includes('x'.repeat(300)), true);
  markIteration(plan, '2.1', { status: 'done', reviewed: 'a | b\n| 9.9 | x', activity: '| z |\n## h', now: NOW });
  const lines = read(path.join(dir, 'progress.md')).split('\n');
  check('pipes and newlines in a cell add neither a column nor a row, and no heading line', [lines.find((l) => l.startsWith('| 2.1')).split('|').length, lines.filter((l) => l.startsWith('|')).length, lines.some((l) => l.startsWith('## h'))], [7, 4, false]);
}
console.log('== confinement: closed set of paths, nothing outside, links refused ==');
{
  const outside = path.join(base, 'outside');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'diary.md'), diaryOf(2)); writeFileSync(path.join(outside, 'progress.md'), PROGRESS);
  // The three writers as thunks; `unchanged` runs fn and says whether every file under `dir` is byte-identical after.
  const calls = (p) => [() => appendDiary(p, note()), () => markIteration(p, '2.1', { status: 'done', now: NOW }), () => setLastActivity(p, { activity: 'x', now: NOW })];
  const unchanged = (dir, fn) => { const b = snap(dir); const r = fn(); return [r, isDeepStrictEqual(b, snap(dir))]; };
  const refusals = (p) => calls(p).map((f) => f()).map((r) => [r.wrote, r.unwritten[0].reason]);
  const { root, plan } = fresh();
  const bad = ['../x', '..', 'a/b', '', 'A', '-a', 'a'.repeat(65), 'a\n', undefined, 'p1/../p1'];
  check('a traversal or malformed slug is refused with 64 by every writer and nothing in the tree changes', unchanged(base, () => bad.flatMap((slug) => calls({ root, slug }).map(exitOf))), [bad.flatMap(() => Array(3).fill([true, 64])), true]);
  check('an iteration that is not N.M or N.Mx is refused with 64', ['1.2.3', '../1', '1.2\n', '', 'a.b', undefined, '1.2/../x', '../1.2', '1.2b.3', '1.2bc', '1.2B', '1.2.b'].map((it) => exitOf(() => markIteration(plan, it, { status: 'done', now: NOW }))), Array(12).fill([true, 64]));
  const split = fresh({ progress: PROGRESS.replace('| 2.1       | Writers', '| 2.1b      | Writers') });
  markIteration(split.plan, '2.1b', { status: 'done', now: NOW });
  check('a split iteration such as 2.1b can be marked', read(path.join(split.dir, 'progress.md')).includes('| 2.1b      | Writers | done'), true);
  mkdirSync(path.join(base, 'linked', '.somi', 'plans'), { recursive: true }); symlinkSync(outside, path.join(base, 'linked', '.somi', 'plans', 'p1'));
  check('a plan directory that is a symlink: all three writers write nothing, and the target is untouched', unchanged(base, () => refusals({ root: path.join(base, 'linked'), slug: 'p1' })), [Array(3).fill([[], 'plan-dir-not-a-plain-directory']), true]);
  mkdirSync(path.join(base, 'linked2')); symlinkSync(outside, path.join(base, 'linked2', '.somi'));
  check('a symlinked .somi above the plan directory is refused too', unchanged(base, () => refusals({ root: path.join(base, 'linked2'), slug: 'p1' })), [Array(3).fill([[], 'plan-dir-not-a-plain-directory']), true]);
  const f = fresh({ diary: null, progress: null });
  symlinkSync(path.join(outside, 'diary.md'), path.join(f.dir, 'diary.md')); symlinkSync(path.join(outside, 'progress.md'), path.join(f.dir, 'progress.md'));
  check('diary.md and progress.md that are symlinks are not followed, written or replaced', unchanged(base, () => refusals(f.plan)), [Array(3).fill([[], 'symlink']), true]);
  const g = fresh({ diary: diaryOf(41) });
  writeFileSync(path.join(outside, 'archive.md'), '# keep\n'); symlinkSync(path.join(outside, 'archive.md'), path.join(g.dir, 'diary-archive.md'));
  const [gr, outsideSame] = unchanged(outside, () => appendDiary(g.plan, note()));
  check('a symlinked diary-archive.md is never written: the entry lands, uncompacted, and the skipped compaction is reported', [outsideSame, headings(read(path.join(g.dir, 'diary.md'))), gr.wrote, gr.unwritten.map((u) => u.reason)], [true, 42, ['.somi/plans/p1/diary.md'], ['symlink']]);
  const q = fresh(); const fifo = path.join(q.dir, 'diary.md'); rmSync(fifo);
  if (spawnSync('mkfifo', [fifo]).status !== 0) console.log('  skip (no mkfifo)');
  else { // a child with a timeout: a regression would block in open(), and must fail instead of hanging the suite
    const code = `import { appendDiary } from ${JSON.stringify(pathToFileURL(path.join(LIB, 'loop-notes.mjs')).href)}; console.log(JSON.stringify(appendDiary(${JSON.stringify(q.plan)}, ${JSON.stringify(note())}).unwritten.map((u) => u.reason)));`;
    const b = snap(q.root); const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { timeout: 5000, encoding: 'utf8' });
    check('a FIFO at diary.md is refused as not-a-regular-file without blocking, and the tree is unchanged', [r.stdout.trim(), snap(q.root)], ['["not-a-regular-file"]', b]);
  }
  const d = fresh({ diary: '# Diary\n\nno entries here\n' });
  check('a diary with no entry headings is left byte-identical and the entry text comes back', unchanged(base, () => appendDiary(d.plan, note()).unwritten.map((u) => [u.reason, u.line.startsWith('## 2026-10-29 09:30 — Writers done')])), [[['not-template-shape', true]], true]);
}
console.log('== atomic write: a failed write is reported, leaves the old file and no temp ==');
if (typeof process.getuid === 'function' && process.getuid() !== 0) {
  const { plan, dir } = fresh();
  const before = snap(dir);
  chmodSync(dir, 0o555);
  let r; let threw = false;
  try { r = [appendDiary(plan, note()), markIteration(plan, '2.1', { status: 'done', now: NOW }), setLastActivity(plan, { activity: 'x', now: NOW })]; } catch { threw = true; }
  chmodSync(dir, 0o755);
  check('with the plan directory unwritable no writer throws: each returns write-failed with the errno code and its line, and the tree is as before', [threw, (r ?? []).map((x) => [x.wrote, x.unwritten.map((u) => [u.file, u.reason, u.code, u.line.length > 0, u.line.includes('EACCES')])]), snap(dir)], [false, [[[], [['diary.md', 'write-failed', 'EACCES', true, false]]], [[], [['progress.md', 'write-failed', 'EACCES', true, false]]], [[], [['progress.md', 'write-failed', 'EACCES', true, false]]]], before]);
  const big = fresh({ diary: diaryOf(41) });
  const bigBefore = snap(big.dir);
  chmodSync(big.dir, 0o555);
  let br; let bthrew = false;
  try { br = appendDiary(big.plan, note()); } catch { bthrew = true; }
  chmodSync(big.dir, 0o755);
  check('a compacting append in an unwritable directory reports both the archive and the diary as write-failed, throws nothing, leaves no temp file', [bthrew, br?.wrote, br?.unwritten.map((u) => [u.file, u.reason, u.code]), snap(big.dir)], [false, [], [['diary-archive.md', 'write-failed', 'EACCES'], ['diary.md', 'write-failed', 'EACCES']], bigBefore]);
} else console.log('  skip (running as root: a mode bit does not stop the write)');

rmSync(base, { recursive: true, force: true });
console.log(`loop notes tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
