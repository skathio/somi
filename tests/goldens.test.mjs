// Goldens for what people read: the rendered views. A failure here means an output moved. Update a golden only when the move is intended;
// moving one also fires the review signal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderPr, renderStatus } from '../scripts/lib/views.mjs';

const golden = (name) => fs.readFileSync(new URL(`./goldens/${name}`, import.meta.url), 'utf8');
const minor = { severity: 'Minor', file: 'src/a.js', line: 3, claim: 'The name is unclear.', fingerprint: 'f1', boundary: false, evidence: null };
const reviews = [{ tree: 't', verdicts: [{ agent: 'somi-reviewer', verdict: 'approve-with-comments' }], findings: [minor, { ...minor }], blocking: [] }];
const ledger = '- decision: money is whole cents\n- constraint: no new dependencies';
const check = { ok: true, full: true, tree: 't' };

test('status view', () => assert.equal(renderStatus({ plan: { total: 3, done: 1, next: 'invoices' }, ledger, reviews, check }), golden('status.txt')));
test('pr view', () => assert.equal(renderPr({ subjects: ['Add the ledger', 'Add invoices'], gate: { ok: true, review: reviews[0] }, ledger, reviews, check, tree: 't' }), golden('pr.md')));
test('a check for other code is not claimed in the pull request', () => {
  assert.match(renderPr({ subjects: [], gate: { ok: true, review: null }, check, tree: 'other' }), /not recorded for this code/);
});
test('views strip control characters from recorded text', () => {
  const hostile = [{ tree: 't', verdicts: [], findings: [{ ...minor, claim: 'x\u001b[31m‮y' }], blocking: [] }];
  assert.equal(renderStatus({ reviews: hostile }).includes('\u001b'), false);
  assert.equal(renderStatus({ reviews: hostile }).includes('‮'), false);
  assert.equal(renderPr({ subjects: ['a\u001b[31m'], gate: { ok: true, review: null }, reviews: hostile }).includes('\u001b'), false);
});
