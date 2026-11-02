// Goldens for what people and tools read: the rendered views and the shape of the state files. A failure here means an output moved.
// Update a golden only when the move is intended; moving one also fires the review signal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deriveCursor, journalProblems } from '../scripts/lib/journal.mjs';
import { renderPr, renderStatus } from '../scripts/lib/views.mjs';

const golden = (name) => fs.readFileSync(new URL(`./goldens/${name}`, import.meta.url), 'utf8');
const events = golden('journal.jsonl').trim().split('\n').map((l) => JSON.parse(l));

test('the golden journal is itself valid', () => assert.deepEqual(journalProblems(events), []));
test('status view', () => assert.equal(renderStatus(events), golden('status.txt')));
test('pr view', () => assert.equal(renderPr(events), golden('pr.md')));
test('cursor shape', () => assert.equal(`${JSON.stringify(deriveCursor(events), null, 2)}\n`, golden('state.json')));
test('views strip control characters from recorded text', () => {
  const hostile = [{ v: 1, seq: 1, key: 'k', type: 'open', milestone: 'm1', title: 'x\u001b[31m‮y', base: 'b', next: 'code' }];
  assert.equal(renderStatus(hostile).includes('\u001b'), false);
  assert.equal(renderStatus(hostile).includes('‮'), false);
});
