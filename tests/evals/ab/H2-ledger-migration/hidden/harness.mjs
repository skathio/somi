// SOMI-CANARY-H2-9c3f5a1e7b2d4806
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Each test spends most of its time waiting for child processes and the disk, so the tests of a file run side by side.
const queued = [];
export const test = (name, body) => queued.push([name, body]);
export function runQueued() {
  describe('ledger', { concurrency: 8 }, () => {
    for (const [name, body] of queued) it(name, body);
  });
}

// The candidate's ledger runs in a child process (the harness-owned runner) per call; database files are built and
// inspected here with node:sqlite directly, never through candidate code.
export const WS = process.env.TASK_WORKSPACE;
const RUNNER = fileURLToPath(new URL('./run.mjs', import.meta.url));
// Every commit syncs to disk, which is slow on a real disk: database files go to memory-backed storage when there is some.
// Residual: a suite that is killed outright leaves its directory there; the next start removes this user's h2-* directories
// that are older than ten minutes.
const base = existsSync('/dev/shm') ? '/dev/shm' : tmpdir();
for (const name of readdirSync(base)) {
  if (!name.startsWith('h2-')) continue;
  try {
    const old = join(base, name);
    const info = statSync(old);
    if (info.uid === process.getuid() && Date.now() - info.mtimeMs > 600000) rmSync(old, { recursive: true, force: true });
  } catch { /* somebody else's, or already gone */ }
}
const dir = mkdtempSync(join(base, 'h2-'));
after(() => rmSync(dir, { recursive: true }));

export const CAP = 9007199254740991;
let counter = 0;
export const newPath = () => join(dir, `ledger-${counter++}.db`);

// Once a run times out, later runs of the same kind fail at once instead of waiting again. Runs on files that start as
// version 1 (the upgrade is the likely place to hang) have a flag of their own, so a hanging upgrade fails only those tests.
const hung = { upgrade: false, plain: false };
const upgradePaths = new Set();
export function run(path, ops) {
  const kind = upgradePaths.has(path) ? 'upgrade' : 'plain';
  assert.ok(!hung[kind], 'an earlier run timed out');
  const nonce = randomUUID();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUNNER, nonce, path], { cwd: WS, env: process.env, timeout: 5000, killSignal: 'SIGKILL', stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { if (out.length < 1 << 24) out += d; });
    child.on('error', () => { hung[kind] = true; reject(new Error('the ledger could not be started')); });
    child.on('close', (code, signal) => {
      const m = new RegExp('\\nH2:' + nonce + ':(.*)\\n').exec(out);
      if (m) return resolve(JSON.parse(m[1]));
      if (signal) hung[kind] = true;
      return reject(new Error('the ledger could not be driven (crash, hang or no answer)'));
    });
    child.stdin.on('error', () => { /* the child ended before reading */ });
    child.stdin.end(JSON.stringify(ops));
  });
}
export const op = (call, ...args) => ({ call, args });
// Runs the operations and returns the values; any refusal or failure is an assertion failure.
export async function must(path, ops) {
  const r = await run(path, ops);
  assert.equal(r.openError, undefined, 'the file could not be opened: ' + JSON.stringify(r.openError));
  return r.results.map((x, i) => {
    assert.equal(x.error, undefined, `operation ${i} (${ops[i].call}) failed: ${JSON.stringify(x.error)}`);
    return x.ok;
  });
}
// Runs the operations and returns the raw results.
export async function attempt(path, ops) {
  const r = await run(path, ops);
  assert.equal(r.openError, undefined, 'the file could not be opened: ' + JSON.stringify(r.openError));
  return r.results;
}

export const plain = (rows) => JSON.parse(JSON.stringify(rows));
export function inspect(path, fn) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return fn(db); } finally { db.close(); }
}
export const userVersion = (path) => inspect(path, (db) => db.prepare('PRAGMA user_version').get().user_version);
export const snapshot = (path) => inspect(path, (db) => plain({
  accounts: db.prepare('SELECT id, name, balance_cents FROM accounts ORDER BY id').all(),
  transfers: db.prepare('SELECT id, from_id, to_id, amount_cents, created_at FROM transfers ORDER BY id').all(),
}));

const V1_DDL = `
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
export const OLD_ACCOUNTS = [['Ada Lovelace', 120050], [`O'Brien "Ops" & Söhne`, CAP], ['Ünïcode ✓ 日本', 0], [`x'); --`, 77]];
export const OLD_TRANSFERS = [[1, 2, 500, '2024-01-05T10:00:00Z'], [2, 3, 1, '2024-02-29T23:59:59Z'], [3, 1, 250, '2024-03-01T00:00:00Z']];
// A database file as the current (version 1) library leaves it: some accounts and transfers, and ids already issued
// beyond the rows that are left (the id counters stand at 50 and 200).
export function buildV1({ version = 1, accounts = OLD_ACCOUNTS, transfers = OLD_TRANSFERS } = {}) {
  const path = newPath();
  upgradePaths.add(path);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA synchronous = OFF');
  db.exec('BEGIN');
  db.exec(V1_DDL);
  const addAccount = db.prepare('INSERT INTO accounts (id, name, balance_cents) VALUES (?, ?, ?)');
  accounts.forEach(([name, cents], i) => addAccount.run(i + 1, name, cents));
  const addTransfer = db.prepare('INSERT INTO transfers (id, from_id, to_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)');
  transfers.forEach(([from, to, cents, at], i) => addTransfer.run(i + 1, from, to, cents, at));
  db.exec("UPDATE sqlite_sequence SET seq = 50 WHERE name = 'accounts'");
  db.exec("UPDATE sqlite_sequence SET seq = 200 WHERE name = 'transfers'");
  db.exec(`PRAGMA user_version = ${version}`);
  db.exec('COMMIT');
  db.close();
  return path;
}

// A new ledger with the given accounts [name, openingCents, currency?]; ids are 1, 2, 3 ... in the order given.
export async function seeded(specs) {
  const path = newPath();
  await must(path, specs.map(([name, openingCents, currency]) => op('createAccount', currency ? { name, openingCents, currency } : { name, openingCents })));
  return path;
}
export const move = (fromId, toId, amountCents, memo) => (memo === undefined ? { fromId, toId, amountCents } : { fromId, toId, amountCents, memo });
export const stateOf = (path) => must(path, [op('listAccounts'), op('listTransfers')]);
