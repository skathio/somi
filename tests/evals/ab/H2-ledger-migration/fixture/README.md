# Ledger

A small library that keeps accounts and the transfers between them in one SQLite file (`node:sqlite`).
Run the tests with `npm test`.

```js
import { openLedger } from './src/ledger.mjs';
const ledger = openLedger('/path/to/ledger.db'); // creates the file when it does not exist
```

## Conventions

- Everything the library refuses throws a `LedgerError` with a stable `code`; the message is for people.
  Codes: `invalid_name`, `duplicate_name`, `invalid_amount`, `same_account`, `not_found`, `insufficient_funds`,
  `balance_overflow`, `unsupported_schema`.
- Money is a whole number of cents. A balance is between 0 and 9007199254740991 (`Number.MAX_SAFE_INTEGER`)
  cents; the database enforces that range itself as well. An amount is a safe integer, at least 1.
- Timestamps are ISO-8601 in UTC with whole seconds: `YYYY-MM-DDTHH:MM:SSZ` (`src/clock.mjs`).
- Ids are never reused: they come from the database (`AUTOINCREMENT`).
- An option that is left out is `undefined`. `null` is a value like any other and is checked like one (for example
  `openingCents: null` is `invalid_amount`).
- Every value reaches SQL through bound parameters, never through string building.
- Writes that belong together run in `inTransaction` (`src/tx.mjs`); transactions do not nest.
- The schema version is stored in the database file (`PRAGMA user_version`). A new, empty file is created at the current
  version. A file written by a newer version than the library knows is refused with `unsupported_schema` and left alone.
- Foreign keys are switched on for every connection.

## API

- `openLedger(path)` returns a ledger. `ledger.close()` closes it.
- `createAccount({ name, openingCents })` returns `{ id, name, balanceCents }`. A name is 1 to 80 characters and unique;
  `openingCents` defaults to 0.
- `getAccount(id)`, `listAccounts()` (by id).
- `transfer({ fromId, toId, amountCents })` moves money and returns `{ id, fromId, toId, amountCents, createdAt }`.
  It is refused when the accounts are the same, unknown, or the source holds too little.
- `listTransfers()` (by id).
