// One error type for everything the ledger refuses; `code` is the stable part, the message is for people.
export class LedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}
