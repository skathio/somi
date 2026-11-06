import { LedgerError } from './errors.mjs';
import { inTransaction } from './tx.mjs';

// The schema version lives in the database file itself (PRAGMA user_version), so the file says what it is.
export const SCHEMA_VERSION = 1;

const CREATE_V1 = `
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES accounts(id),
  to_id INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL,
  CHECK (from_id <> to_id)
);
`;

export function prepareSchema(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > SCHEMA_VERSION) {
    throw new LedgerError('unsupported_schema', `database has schema version ${version}, this library knows up to ${SCHEMA_VERSION}`);
  }
  if (version === SCHEMA_VERSION) return;
  inTransaction(db, () => {
    db.exec(CREATE_V1);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}
