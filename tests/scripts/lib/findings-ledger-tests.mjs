#!/usr/bin/env node
// In-process tests of scripts/lib/findings-ledger.mjs: locus identity, the consecutive-pass breaker, the
// no-write guarantee on bad input, and that the library never reads the process environment.
// Invoked from tests/scripts/loop-engine.sh. The CLI's bytes are pinned by tests/scripts/run.sh and its goldens.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ledgerPaths, normalizeTitle, recordFindings } from '../../../scripts/lib/findings-ledger.mjs';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'lib');
let pass = 0; let fail = 0;
// Strict deep equality: undefined, null and a missing key are three different answers.
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};

const root = mkdtempSync(path.join(tmpdir(), 'findings-ledger-'));
const decoy = mkdtempSync(path.join(tmpdir(), 'findings-decoy-'));
const now = () => '2026-01-01';
const rec = (slug, input, extra = {}) => recordFindings({ root, slug, review: 'r.md', run: 'R1', pass: 1, input, now, ...extra });
const ledgerOf = (slug) => JSON.parse(readFileSync(ledgerPaths(root, slug).file, 'utf8'));
const F = { file: 'src/a.txt', symbol: 'HandleWebhook', title: 'Missing rate limit on retry path', severity: 'Major', confidence: 'High' };

console.log('== findings ledger: the environment is not an input ==');
const envBefore = JSON.stringify(process.env);
process.env.CLAUDE_PROJECT_DIR = decoy;
process.env.SOMI_LOOP_STATE_DIR = decoy;
const sentinel = rec('sentinel', [F]);
check('a CLAUDE_PROJECT_DIR in process.env does not redirect the ledger away from the root it was given', [sentinel.code, existsSync(ledgerPaths(root, 'sentinel').file), existsSync(path.join(decoy, '.somi'))], [0, true, false]);
delete process.env.CLAUDE_PROJECT_DIR;
delete process.env.SOMI_LOOP_STATE_DIR;
const source = readFileSync(path.join(LIB, 'findings-ledger.mjs'), 'utf8');
const code = source.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
check('findings-ledger.mjs has no process.env outside comments', /process\s*(\.|\[)\s*['"]?env/.test(code), false);

console.log('== findings ledger: normalizeTitle ==');
const titles = [['', ''], ['Bug', 'bug'], ['one two three four five six seven eight nine ten', 'one two three four five six seven eight'], ['   Missing rate limit   ', 'missing rate limit'], ['Missing   rate    limit', 'missing rate limit'], ['Missing rate-limit! (on retry) path?', 'missing rate limit on retry path']];
for (const [t, want] of titles) check(`normalizeTitle(${JSON.stringify(t)})`, normalizeTitle(t), want);
check('İstanbul lowercases byte-wise (ASCII only): the dotted capital is dropped, not turned into an "i"', normalizeTitle('İstanbul'), 'stanbul');
check('café loses its accented letter instead of keeping it', normalizeTitle('café'), 'caf');

console.log('== findings ledger: locus identity ==');
const first = rec('id', [F]);
check('a first sighting is new F-1 and prints one JSON line', first, { lines: [JSON.stringify({ id: 'F-1', state: 'new', recurring_consecutive: false, recurring_cross_run: false })], code: 0, message: '' });
check('the stored finding has the documented shape', ledgerOf('id'), { next_id: 2, findings: [{ id: 'F-1', key: 'src/a.txt|handlewebhook|missing rate limit on retry path', locus: { file: 'src/a.txt', symbol: 'HandleWebhook' }, title: F.title, severity: 'Major', confidence: 'High', status: 'open', introduced_by: 'r.md', resolved_by: null, seen: [{ review: 'r.md', run: 'R1', pass: 1, date: '2026-01-01' }] }] });
const variant = rec('id', [{ file: 'src/a.txt', symbol: 'handlewebhook', title: 'MISSING rate-limit on retry path!' }], { pass: 3 });
check('the same locus in another case and punctuation is the same finding (known, not new)', JSON.parse(variant.lines[0]).id + JSON.parse(variant.lines[0]).state, 'F-1known');
const other = rec('id', [{ file: 'src/b.txt', title: 'Other' }]);
check('a different file is a new finding with the next id and the defaults', [JSON.parse(other.lines[0]).id, ledgerOf('id').findings[1].severity, ledgerOf('id').findings[1].confidence, ledgerOf('id').findings[1].locus.symbol], ['F-2', 'Minor', 'Medium', '']);

console.log('== findings ledger: the consecutive-pass breaker ==');
const p1 = rec('brk', [F], { pass: 1 });
const p2 = rec('brk', [F], { pass: 2 });
check('pass 1 then pass 2 of the same run is a consecutive recurrence: code 5', [p1.code, p2.code, JSON.parse(p2.lines[0]).recurring_consecutive, JSON.parse(p2.lines[0]).recurring_cross_run], [0, 5, true, false]);
const g1 = rec('gap', [F], { pass: 1 });
const g3 = rec('gap', [F], { pass: 3 });
check('pass 1 then pass 3 is not consecutive and not cross-run: code 0', [g1.code, g3.code, JSON.parse(g3.lines[0]).recurring_consecutive, JSON.parse(g3.lines[0]).recurring_cross_run], [0, 0, false, false]);
const x2 = rec('gap', [F], { run: 'R2', pass: 4 });
check('another run seeing an open finding is cross-run, not consecutive: code 0', [x2.code, JSON.parse(x2.lines[0]).recurring_consecutive, JSON.parse(x2.lines[0]).recurring_cross_run], [0, false, true]);
const batch = rec('batch', [F, { file: 'src/c.txt', title: 'Fresh' }], { pass: 1 });
const batch2 = rec('batch', [{ file: 'src/c.txt', title: 'Fresh' }, F], { pass: 2 });
check('the breaker is judged after every finding is processed: all lines come back, then code 5', [batch.code, batch2.lines.length, batch2.code], [0, 2, 5]);

console.log('== findings ledger: bad input writes nothing ==');
const missing = rec('bad1', [{ file: 'src/a.txt' }]);
check('a finding with no title returns 64 and the exact stderr line, with no stdout', missing, { lines: [], code: 64, message: 'somi-findings: finding 0 needs at least {file, title}' });
check('and the ledger was not even created', existsSync(ledgerPaths(root, 'bad1').dir), false);
const later = rec('bad2', [F, { title: 'no file' }]);
check('a bad element after a good one is named by index and the good one is not recorded either', [later.code, later.message, existsSync(ledgerPaths(root, 'bad2').file)], [64, 'somi-findings: finding 1 needs at least {file, title}', false]);
check('a null element is malformed, not a crash', rec('bad3', [null]).code, 64);
const before = readFileSync(ledgerPaths(root, 'id').file, 'utf8');
rec('id', [F, { file: 'x' }]);
check('a refused batch leaves an existing ledger byte for byte as it was', readFileSync(ledgerPaths(root, 'id').file, 'utf8'), before);
check('none of the calls touched process.env', JSON.stringify(process.env), envBefore);

rmSync(root, { recursive: true, force: true });
rmSync(decoy, { recursive: true, force: true });
console.log(`findings ledger tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
