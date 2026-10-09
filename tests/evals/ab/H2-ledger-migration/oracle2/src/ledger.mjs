// SOMI-CANARY-H2-9c3f5a1e7b2d4806
import { DatabaseSync } from 'node:sqlite';
import { isoNow } from './clock.mjs';
import { LedgerError } from './errors.mjs';
import { prepareSchema } from './schema.mjs';
import { inTransaction } from './tx.mjs';
import { MAX_CENTS, checkAmount, checkCurrency, checkMemo, checkName } from './validate.mjs';

const BATCH_LIMIT = 500;

const account = (r) => ({ id: r.id, name: r.name, currency: r.currency, balanceCents: r.balance_cents });
const transferRecord = (r) => ({ id: r.id, fromId: r.from_id, toId: r.to_id, amountCents: r.amount_cents, memo: r.memo, createdAt: r.created_at });

export function openLedger(path) {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    prepareSchema(db);
  } catch (error) {
    db.close();
    throw error;
  }
  const byId = (id) => {
    const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    if (!row) throw new LedgerError('not_found', `no account with id ${id}`);
    return row;
  };

  function move(request) {
    const { fromId, toId } = request;
    const amount = checkAmount(request.amountCents);
    const memo = checkMemo(request.memo);
    if (fromId === toId) throw new LedgerError('same_account', 'same account');
    const [from, to] = [byId(fromId), byId(toId)];
    if (from.currency !== to.currency) throw new LedgerError('currency_mismatch', 'different currencies');
    if (amount > from.balance_cents) throw new LedgerError('insufficient_funds', 'not enough money');
    if (amount > MAX_CENTS - to.balance_cents) throw new LedgerError('balance_overflow', 'balance would exceed the maximum');
    db.prepare('UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ?').run(amount, fromId);
    db.prepare('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?').run(amount, toId);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO transfers (from_id, to_id, amount_cents, memo, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(fromId, toId, amount, memo, isoNow());
    return transferRecord(db.prepare('SELECT * FROM transfers WHERE id = ?').get(lastInsertRowid));
  }

  return {
    createAccount({ name, openingCents = 0, currency = 'USD' }) {
      checkName(name);
      checkAmount(openingCents, { allowZero: true });
      checkCurrency(currency);
      const clash = db.prepare('SELECT 1 FROM accounts WHERE name = ?').get(name);
      if (clash) throw new LedgerError('duplicate_name', 'name already used');
      const { lastInsertRowid } = db.prepare('INSERT INTO accounts (name, balance_cents, currency) VALUES (?, ?, ?)').run(name, openingCents, currency);
      return account(byId(lastInsertRowid));
    },
    getAccount: (id) => account(byId(id)),
    listAccounts: () => db.prepare('SELECT * FROM accounts ORDER BY id').all().map(account),
    listTransfers: () => db.prepare('SELECT * FROM transfers ORDER BY id').all().map(transferRecord),
    transfer: (request) => inTransaction(db, () => move(request)),
    transferBatch(list) {
      if (!Array.isArray(list) || list.length > BATCH_LIMIT) throw new LedgerError('invalid_batch', 'expected a list of at most 500 transfers');
      return inTransaction(db, () => {
        const records = [];
        for (const [index, request] of list.entries()) {
          try {
            records.push(move(request ?? {}));
          } catch (error) {
            if (error instanceof LedgerError) error.index = index;
            throw error;
          }
        }
        return records;
      });
    },
    close: () => db.close(),
  };
}
