// SOMI-CANARY-H2-9c3f5a1e7b2d4806
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../src/ledger.mjs';

test('transferBatch applies every transfer or none, and a new file is at version 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  try {
    const path = join(dir, 'fresh.db');
    const ledger = openLedger(path);
    const a = ledger.createAccount({ name: 'a', openingCents: 50 });
    const b = ledger.createAccount({ name: 'b', currency: 'EUR' });
    const c = ledger.createAccount({ name: 'c' });
    assert.throws(
      () => ledger.transferBatch([{ fromId: a.id, toId: c.id, amountCents: 20 }, { fromId: a.id, toId: b.id, amountCents: 5 }]),
      { code: 'currency_mismatch', index: 1 },
    );
    assert.equal(ledger.getAccount(a.id).balanceCents, 50);
    ledger.transferBatch([{ fromId: a.id, toId: c.id, amountCents: 20, memo: 'rent' }]);
    assert.equal(ledger.listTransfers()[0].memo, 'rent');
    ledger.close();
    const raw = new DatabaseSync(path, { readOnly: true });
    assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 2);
    raw.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
