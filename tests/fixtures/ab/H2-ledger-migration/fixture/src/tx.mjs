import { LedgerError } from './errors.mjs';

// Writes that belong together run inside one transaction: all of them are kept, or none is.
// Transactions do not nest: asking for one while another is open is a programming error.
export function inTransaction(db, work) {
  if (db.isTransaction) throw new LedgerError('nested_transaction', 'a transaction is already open');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
