import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../src/ledger.mjs';

let dir;
let ledger;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  ledger = openLedger(join(dir, 'ledger.db'));
});
after(() => {
  ledger.close();
  rmSync(dir, { recursive: true });
});

test('accounts keep their name exactly, quotes included', () => {
  const a = ledger.createAccount({ name: `O'Brien "Ops"`, openingCents: 500 });
  assert.deepEqual(ledger.getAccount(a.id), { id: a.id, name: `O'Brien "Ops"`, balanceCents: 500 });
});

test('a second account with the same name is refused', () => {
  ledger.createAccount({ name: 'dup' });
  assert.throws(() => ledger.createAccount({ name: 'dup' }), { code: 'duplicate_name' });
});

test('a transfer moves the money and is recorded with a UTC timestamp', () => {
  const a = ledger.createAccount({ name: 'src', openingCents: 100 });
  const b = ledger.createAccount({ name: 'dst' });
  const t = ledger.transfer({ fromId: a.id, toId: b.id, amountCents: 40 });
  assert.match(t.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(ledger.getAccount(a.id).balanceCents, 60);
  assert.equal(ledger.getAccount(b.id).balanceCents, 40);
  assert.equal(ledger.listTransfers().at(-1).id, t.id);
});

test('a transfer that cannot be paid changes nothing', () => {
  const a = ledger.createAccount({ name: 'poor', openingCents: 5 });
  const b = ledger.createAccount({ name: 'rich' });
  assert.throws(() => ledger.transfer({ fromId: a.id, toId: b.id, amountCents: 6 }), { code: 'insufficient_funds' });
  assert.equal(ledger.getAccount(a.id).balanceCents, 5);
});

test('amounts must be whole positive cents', () => {
  const a = ledger.createAccount({ name: 'x1', openingCents: 5 });
  const b = ledger.createAccount({ name: 'x2' });
  for (const amountCents of [0, -1, 1.5, '3', 2 ** 53]) {
    assert.throws(() => ledger.transfer({ fromId: a.id, toId: b.id, amountCents }), { code: 'invalid_amount' });
  }
});
