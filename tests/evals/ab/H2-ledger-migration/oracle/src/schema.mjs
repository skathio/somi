// SOMI-CANARY-H2-9c3f5a1e7b2d4806
import { LedgerError } from './errors.mjs';
import { inTransaction } from './tx.mjs';

// The schema version lives in the database file itself (PRAGMA user_version), so the file says what it is.
export const SCHEMA_VERSION = 2;

// MIGRATIONS[n] upgrades a database from version n to version n + 1 (version 0 is an empty file).
const MIGRATIONS = [
  `
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
`,
  `
ALTER TABLE accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE transfers ADD COLUMN memo TEXT;
`,
];

const readVersion = (db) => db.prepare('PRAGMA user_version').get().user_version;

function refuseNewer(version) {
  if (version > SCHEMA_VERSION) {
    throw new LedgerError('unsupported_schema', `database has schema version ${version}, this library knows up to ${SCHEMA_VERSION}`);
  }
}

export function prepareSchema(db) {
  const seen = readVersion(db);
  refuseNewer(seen);
  if (seen === SCHEMA_VERSION) return;
  inTransaction(db, () => {
    const version = readVersion(db);
    refuseNewer(version);
    for (let from = version; from < SCHEMA_VERSION; from++) db.exec(MIGRATIONS[from]);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}
