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
  `balance_overflow`, `unsupported_schema`, `invalid_currency`, `currency_mismatch`, `invalid_memo`, `invalid_batch`.
- Money is a whole number of cents. A balance is between 0 and 9007199254740991 (`Number.MAX_SAFE_INTEGER`)
  cents; the database enforces that range itself as well. An amount is a safe integer, at least 1.
- Timestamps are ISO-8601 in UTC with whole seconds: `YYYY-MM-DDTHH:MM:SSZ` (`src/clock.mjs`).
- Ids are never reused: they come from the database (`AUTOINCREMENT`).
- An option that is left out is `undefined`. `null` is a value like any other and is checked like one (for example
  `openingCents: null` is `invalid_amount`, `memo: null` is `invalid_memo`).
- Every value reaches SQL through bound parameters, never through string building.
- Writes that belong together run in `inTransaction` (`src/tx.mjs`); a call made inside a transaction becomes a savepoint.
- The schema version is stored in the database file (`PRAGMA user_version`). A new, empty file is created at the current
  version (2). A file written by an older version is upgraded in place when it is opened, in one transaction, and opening
  it again changes nothing. A file written by a newer version than the library knows is refused with
  `unsupported_schema` and left alone.
- Foreign keys are switched on for every connection.

## API

- `openLedger(path)` returns a ledger. `ledger.close()` closes it.
- `createAccount({ name, openingCents, currency })` returns `{ id, name, currency, balanceCents }`. A name is 1 to 80
  characters and unique (`duplicate_name`); `openingCents` defaults to 0; `currency` is three capital letters and defaults to `USD`
  (`invalid_currency` otherwise). Accounts that existed before schema version 2 are in `USD`.
- `getAccount(id)`, `listAccounts()` (by id).
- `transfer({ fromId, toId, amountCents, memo })` moves money and returns
  `{ id, fromId, toId, amountCents, memo, createdAt }`. It is refused when the accounts are the same, unknown, in
  different currencies (`currency_mismatch`), or the source holds too little. `memo` is optional text of up to 200
  characters, kept as given (`invalid_memo` otherwise); without one it is `null`, as it is for transfers made before
  schema version 2.
- `transferBatch(requests)` applies a list of transfers (at most 500) in order, all or nothing, and returns their records.
  A transfer that fails is reported with the error code it would get alone, and the error's `index` is its position in
  the list; when several would fail, the first is reported. Nothing from the batch is kept. An empty list returns `[]`; anything else than a list of at most 500 is
  `invalid_batch`.
- `listTransfers()` (by id).

<!-- SOMI-CANARY-H2-9c3f5a1e7b2d4806 -->
