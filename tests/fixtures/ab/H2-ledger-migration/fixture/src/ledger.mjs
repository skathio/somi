import { DatabaseSync } from 'node:sqlite';
import { isoNow } from './clock.mjs';
import { LedgerError } from './errors.mjs';
import { prepareSchema } from './schema.mjs';
import { inTransaction } from './tx.mjs';
import { MAX_CENTS, checkAmount, checkName } from './validate.mjs';

const toAccount = (row) => ({ id: row.id, name: row.name, balanceCents: row.balance_cents });
const toTransfer = (row) => ({ id: row.id, fromId: row.from_id, toId: row.to_id, amountCents: row.amount_cents, createdAt: row.created_at });

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

  return {
    createAccount({ name, openingCents = 0 }) {
      checkName(name);
      checkAmount(openingCents, { allowZero: true });
      try {
        const info = db.prepare('INSERT INTO accounts (name, balance_cents) VALUES (?, ?)').run(name, openingCents);
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

    transfer({ fromId, toId, amountCents }) {
      const amount = checkAmount(amountCents);
      if (fromId === toId) throw new LedgerError('same_account', 'cannot transfer to the same account');
      return inTransaction(db, () => {
        const from = requireAccount(fromId);
        const to = requireAccount(toId);
        if (from.balance_cents < amount) throw new LedgerError('insufficient_funds', `account ${fromId} holds ${from.balance_cents} cents`);
        if (to.balance_cents + amount > MAX_CENTS) throw new LedgerError('balance_overflow', `account ${toId} cannot hold more than ${MAX_CENTS} cents`);
        const update = db.prepare('UPDATE accounts SET balance_cents = ? WHERE id = ?');
        update.run(from.balance_cents - amount, fromId);
        update.run(to.balance_cents + amount, toId);
        const info = db.prepare('INSERT INTO transfers (from_id, to_id, amount_cents, created_at) VALUES (?, ?, ?, ?)').run(fromId, toId, amount, isoNow());
        return toTransfer(db.prepare('SELECT * FROM transfers WHERE id = ?').get(info.lastInsertRowid));
      });
    },

    close() {
      db.close();
    },
  };
}
