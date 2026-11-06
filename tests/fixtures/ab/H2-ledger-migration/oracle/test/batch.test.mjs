// SOMI-CANARY-H2-9c3f5a1e7b2d4806
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../src/ledger.mjs';

const batch = (ledger, list) => ledger.transferBatch(list);

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-'));
});
after(() => {
  rmSync(dir, { recursive: true });
});

const V1 = `
CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
  balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents BETWEEN 0 AND 9007199254740991));
CREATE TABLE transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER NOT NULL REFERENCES accounts(id),
  to_id INTEGER NOT NULL REFERENCES accounts(id), amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL, CHECK (from_id <> to_id));
INSERT INTO accounts (name, balance_cents) VALUES ('old', 700);
PRAGMA user_version = 1;
`;

test('a version 1 file is upgraded in place, once, and keeps its data', () => {
  const path = join(dir, 'old.db');
  const raw = new DatabaseSync(path);
  raw.exec(V1);
  raw.close();
  for (let i = 0; i < 2; i++) {
    const ledger = openLedger(path);
    assert.deepEqual(ledger.listAccounts(), [{ id: 1, name: 'old', currency: 'USD', balanceCents: 700 }]);
    ledger.close();
  }
  const check = new DatabaseSync(path, { readOnly: true });
  assert.equal(check.prepare('PRAGMA user_version').get().user_version, 2);
  check.close();
});

test('a batch is all or nothing, in order', () => {
  const ledger = openLedger(join(dir, 'batch.db'));
  const a = ledger.createAccount({ name: 'a', openingCents: 100 });
  const b = ledger.createAccount({ name: 'b' });
  const c = ledger.createAccount({ name: 'c' });
  const done = batch(ledger, [
    { fromId: a.id, toId: b.id, amountCents: 100, memo: `it's "ok"` },
    { fromId: b.id, toId: c.id, amountCents: 100 },
  ]);
  assert.equal(done.length, 2);
  assert.equal(done[0].memo, `it's "ok"`);
  assert.equal(ledger.getAccount(c.id).balanceCents, 100);
  assert.throws(
    () => batch(ledger, [{ fromId: c.id, toId: a.id, amountCents: 100 }, { fromId: c.id, toId: a.id, amountCents: 1 }]),
    (error) => error.code === 'insufficient_funds' && error.index === 1,
  );
  assert.equal(ledger.getAccount(c.id).balanceCents, 100);
  assert.equal(ledger.listTransfers().length, 2);
  ledger.close();
});

test('currencies and memos are checked', () => {
  const ledger = openLedger(join(dir, 'money.db'));
  const usd = ledger.createAccount({ name: 'usd', openingCents: 10 });
  const eur = ledger.createAccount({ name: 'eur', currency: 'EUR' });
  assert.throws(() => ledger.createAccount({ name: 'bad', currency: 'eur' }), { code: 'invalid_currency' });
  assert.throws(() => ledger.transfer({ fromId: usd.id, toId: eur.id, amountCents: 1 }), { code: 'currency_mismatch' });
  assert.throws(() => ledger.transfer({ fromId: usd.id, toId: eur.id, amountCents: 1, memo: 5 }), { code: 'invalid_memo' });
  ledger.close();
});
