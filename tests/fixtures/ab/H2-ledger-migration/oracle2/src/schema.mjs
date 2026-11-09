// SOMI-CANARY-H2-9c3f5a1e7b2d4806
import { LedgerError } from './errors.mjs';
import { inTransaction } from './tx.mjs';

export const SCHEMA_VERSION = 2;

const FRESH = `
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'USD',
  balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES accounts(id),
  to_id INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  memo TEXT,
  created_at TEXT NOT NULL,
  CHECK (from_id <> to_id)
);
`;

const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

export function prepareSchema(db) {
  if (version(db) > SCHEMA_VERSION) throw new LedgerError('unsupported_schema', `schema version ${version(db)} is newer than ${SCHEMA_VERSION}`);
  if (version(db) === SCHEMA_VERSION) return;
  inTransaction(db, () => {
    const current = version(db);
    if (current === 0) db.exec(FRESH);
    else if (current === 1) {
      db.exec("ALTER TABLE accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'");
      db.exec('ALTER TABLE transfers ADD COLUMN memo TEXT');
    } else throw new LedgerError('unsupported_schema', `unknown schema version ${current}`);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}
