// SOMI-CANARY-H2-9c3f5a1e7b2d4806
// Writes that belong together are kept or undone together. A call made while a transaction is open becomes a savepoint
// inside it, so nesting works.
let depth = 0;

export function inTransaction(db, work) {
  const nested = db.isTransaction;
  const name = `sp${depth++}`;
  db.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec(nested ? `RELEASE ${name}` : 'COMMIT');
    return result;
  } catch (error) {
    if (nested) db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
    else if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    depth--;
  }
}
