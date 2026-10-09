// SOMI-CANARY-H2-9c3f5a1e7b2d4806
import { DatabaseSync } from 'node:sqlite';
import { isoNow } from './clock.mjs';
import { LedgerError } from './errors.mjs';
import { prepareSchema } from './schema.mjs';
import { inTransaction } from './tx.mjs';
import { MAX_BATCH, MAX_CENTS, checkAmount, checkCurrency, checkMemo, checkName } from './validate.mjs';

const toAccount = (row) => ({ id: row.id, name: row.name, currency: row.currency, balanceCents: row.balance_cents });
const toTransfer = (row) => ({ id: row.id, fromId: row.from_id, toId: row.to_id, amountCents: row.amount_cents, memo: row.memo, createdAt: row.created_at });

/** Opens (creating or preparing if needed) the ledger stored in the file at `path`. */
export function openLedger(path) {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    prepareSchema(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return makeLedger(db);
}

function makeLedger(db) {
  const selectAccount = db.prepare('SELECT * FROM accounts WHERE id = ?');

  function requireAccount(id) {
    const row = selectAccount.get(id);
    if (!row) throw new LedgerError('not_found', `no account with id ${id}`);
    return row;
  }

  // One transfer, inside the caller's transaction.
  function applyTransfer({ fromId, toId, amountCents, memo }) {
    const amount = checkAmount(amountCents);
    const note = checkMemo(memo);
    if (fromId === toId) throw new LedgerError('same_account', 'cannot transfer to the same account');
    const from = requireAccount(fromId);
    const to = requireAccount(toId);
    if (from.currency !== to.currency) throw new LedgerError('currency_mismatch', `${from.currency} cannot be moved to ${to.currency}`);
    if (from.balance_cents < amount) throw new LedgerError('insufficient_funds', `account ${fromId} holds ${from.balance_cents} cents`);
    if (to.balance_cents + amount > MAX_CENTS) throw new LedgerError('balance_overflow', `account ${toId} cannot hold more than ${MAX_CENTS} cents`);
    const update = db.prepare('UPDATE accounts SET balance_cents = ? WHERE id = ?');
    update.run(from.balance_cents - amount, fromId);
    update.run(to.balance_cents + amount, toId);
    const info = db
      .prepare('INSERT INTO transfers (from_id, to_id, amount_cents, memo, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(fromId, toId, amount, note, isoNow());
    return toTransfer(db.prepare('SELECT * FROM transfers WHERE id = ?').get(info.lastInsertRowid));
  }

  return {
    createAccount({ name, openingCents = 0, currency = 'USD' }) {
      checkName(name);
      checkAmount(openingCents, { allowZero: true });
      checkCurrency(currency);
      try {
        const info = db.prepare('INSERT INTO accounts (name, balance_cents, currency) VALUES (?, ?, ?)').run(name, openingCents, currency);
        return toAccount(selectAccount.get(info.lastInsertRowid));
      } catch (error) {
        if (error.errcode === 2067) throw new LedgerError('duplicate_name', `an account named ${JSON.stringify(name)} exists`);
        throw error;
      }
    },

    getAccount(id) {
      return toAccount(requireAccount(id));
    },

    listAccounts() {
      return db.prepare('SELECT * FROM accounts ORDER BY id').all().map(toAccount);
    },

    listTransfers() {
      return db.prepare('SELECT * FROM transfers ORDER BY id').all().map(toTransfer);
    },

    transfer(request) {
      return inTransaction(db, () => applyTransfer(request));
    },

    transferBatch(requests) {
      if (!Array.isArray(requests) || requests.length > MAX_BATCH) {
        throw new LedgerError('invalid_batch', `a batch is a list of at most ${MAX_BATCH} transfers`);
      }
      return inTransaction(db, () =>
        requests.map((request, index) => {
          try {
            return applyTransfer(request ?? {});
          } catch (error) {
            if (error instanceof LedgerError) error.index = index;
            throw error;
          }
        }),
      );
    },

    close() {
      db.close();
    },
  };
}
