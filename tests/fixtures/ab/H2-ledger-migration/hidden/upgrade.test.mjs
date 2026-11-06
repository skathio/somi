// SOMI-CANARY-H2-9c3f5a1e7b2d4806
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { attempt, buildV1, inspect, move, must, newPath, OLD_ACCOUNTS, OLD_TRANSFERS, op, plain, run, runQueued, seeded, snapshot, test, userVersion, WS } from './harness.mjs';

// ---- AC1 upgrade in place -------------------------------------------------------------------------------------

test('AC1 [functional] opening a version 1 file upgrades it in place and loses or alters nothing', async () => {
  const path = buildV1();
  const before = snapshot(path);
  const [accounts] = await must(path, [op('listAccounts')]);
  assert.equal(userVersion(path), 2, 'the file was not upgraded');
  assert.deepEqual(snapshot(path), before);
  assert.deepEqual(accounts.map((a) => [a.id, a.name, a.balanceCents]), OLD_ACCOUNTS.map(([n, c], i) => [i + 1, n, c]));
});

test('AC1 [regression] ids keep counting after the highest id ever issued, not after the rows that are left', async () => {
  const path = buildV1();
  const [account, transfer] = await must(path, [op('createAccount', { name: 'newcomer' }), op('transfer', move(1, 4, 10))]);
  assert.equal(account.id, 51);
  assert.equal(transfer.id, 201);
});

test('AC1 [regression] the database still refuses a negative balance and a repeated name after the upgrade', async () => {
  const path = buildV1();
  await must(path, []);
  const db = new DatabaseSync(path);
  try {
    assert.throws(() => db.exec('UPDATE accounts SET balance_cents = -1 WHERE id = 1'));
    assert.throws(() => db.exec('UPDATE accounts SET balance_cents = 9007199254740992 WHERE id = 3'));
    assert.throws(() => db.exec("INSERT INTO accounts (name, balance_cents) VALUES ('Ada Lovelace', 0)"));
  } finally { db.close(); }
});

test('AC1 [regression] after the upgrade every transfer still points at an existing account', async () => {
  const path = buildV1();
  await must(path, []);
  inspect(path, (db) => assert.deepEqual(plain(db.prepare('PRAGMA foreign_key_check').all()), []));
  inspect(path, (db) => assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transfers').get().n, 3));
});

test('AC1 [regression] the database still refuses a transfer of nothing, to itself or with an unknown account after the upgrade', async () => {
  const path = buildV1();
  await must(path, []);
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const add = (from, to, cents) => () => db.prepare("INSERT INTO transfers (from_id, to_id, amount_cents, created_at) VALUES (?, ?, ?, '2024-01-01T00:00:00Z')").run(from, to, cents);
    assert.throws(add(1, 3, 0));
    assert.throws(add(1, 1, 5));
    assert.throws(add(1, 999, 5));
  } finally { db.close(); }
});

// ---- AC2 currency -----------------------------------------------------------------------------------------------

test('AC2 [functional] accounts that existed before the upgrade are in USD and old transfers have no memo', async () => {
  const path = buildV1();
  const [accounts, transfers] = await must(path, [op('listAccounts'), op('listTransfers')]);
  assert.equal(accounts.length, 4);
  assert.ok(accounts.every((a) => a.currency === 'USD'), 'every old account is in USD');
  assert.equal(transfers.length, 3);
  assert.ok(transfers.every((t) => t.memo === null), 'old transfers have memo null');
  assert.deepEqual(transfers.map((t) => [t.id, t.amountCents, t.createdAt]), OLD_TRANSFERS.map(([, , c, at], i) => [i + 1, c, at]));
});

test('AC2 [functional] a new account is in USD unless a currency is given, and getAccount and listAccounts show it', async () => {
  const path = newPath();
  const [usd, eur, jpy, got, list] = await must(path, [
    op('createAccount', { name: 'plain' }), op('createAccount', { name: 'euro', currency: 'EUR' }), op('createAccount', { name: 'yen', currency: 'JPY', openingCents: 500 }),
    op('getAccount', 2), op('listAccounts'),
  ]);
  assert.equal(usd.currency, 'USD');
  assert.equal(eur.currency, 'EUR');
  assert.equal(jpy.currency, 'JPY');
  assert.deepEqual(got, eur);
  assert.deepEqual(list.map((a) => [a.name, a.currency, a.balanceCents]), [['plain', 'USD', 0], ['euro', 'EUR', 0], ['yen', 'JPY', 500]]);
});

test('AC2 [safety] a currency that is not three capital letters is refused with invalid_currency and no account is created', async () => {
  const path = newPath();
  const bad = ['usd', 'Usd', 'EURO', 'EU', '', ' USD', 'U$D', 'É€É', 'U1D', 5];
  const results = await attempt(path, [...bad.map((currency, i) => op('createAccount', { name: `bad${i}`, currency })), op('listAccounts')]);
  assert.deepEqual(results.slice(0, -1).map((r) => r.error?.code), bad.map(() => 'invalid_currency'));
  assert.deepEqual(results.at(-1).ok, []);
});

// ---- AC3 memo ---------------------------------------------------------------------------------------------------

const MEMOS = [`Robert'); --`, '"quoted", with comma', 'two\nlines\r\nand a tab\t', '  padded  ', '日本語 ✓ café', '100% _wild_ \\ back', "'", 'x'.repeat(200)];

test('AC3 [functional] a memo is kept exactly as given, in the returned record and when read back later', async () => {
  const path = await seeded([['a', 100000], ['b', 0]]);
  const made = await must(path, MEMOS.map((memo) => op('transfer', move(1, 2, 1, memo))));
  assert.deepEqual(made.map((t) => t.memo), MEMOS);
  const [listed] = await must(path, [op('listTransfers')]);
  assert.deepEqual(listed.map((t) => t.memo), MEMOS);
});

test('AC3 [functional] a transfer made without a memo shows memo null, in the record and when read back', async () => {
  const path = await seeded([['a', 100], ['b', 0]]);
  const [record] = await must(path, [op('transfer', move(1, 2, 1))]);
  assert.equal(record.memo, null);
  const [listed] = await must(path, [op('listTransfers')]);
  assert.deepEqual(listed.map((t) => t.memo), [null]);
});

test('AC3 [boundary] a memo of 200 characters is accepted and one of 201 is refused with invalid_memo', async () => {
  const path = await seeded([['a', 100], ['b', 0]]);
  const [fits, tooLong, list] = await attempt(path, [op('transfer', move(1, 2, 1, 'm'.repeat(200))), op('transfer', move(1, 2, 1, 'm'.repeat(201))), op('listTransfers')]);
  assert.equal(fits.ok?.memo?.length, 200);
  assert.equal(tooLong.error?.code, 'invalid_memo');
  assert.equal(list.ok.length, 1);
});

test('AC3 [safety] a memo that is not text is refused with invalid_memo and nothing changes', async () => {
  const path = await seeded([['a', 100], ['b', 0]]);
  const notText = [5, true, {}, ['x'], null];
  const [ok, ...rest] = await attempt(path, [op('transfer', move(1, 2, 1, 'fine')), ...notText.map((memo) => op('transfer', move(1, 2, 1, memo))), op('listAccounts')]);
  assert.equal(ok.ok?.memo, 'fine');
  assert.deepEqual(rest.slice(0, notText.length).map((r) => r.error?.code), notText.map(() => 'invalid_memo'));
  assert.deepEqual(rest[notText.length].ok.map((a) => a.balanceCents), [99, 1]);
});

// ---- AC4 currency mismatch --------------------------------------------------------------------------------------

test('AC4 [functional] money moves only between accounts of the same currency', async () => {
  const path = await seeded([['usd', 100], ['eur', 100, 'EUR'], ['eur2', 0, 'EUR']]);
  const [crossing, back, same, accounts] = await attempt(path, [op('transfer', move(1, 2, 10)), op('transfer', move(2, 1, 10)), op('transfer', move(2, 3, 10)), op('listAccounts')]);
  assert.equal(crossing.error?.code, 'currency_mismatch');
  assert.equal(back.error?.code, 'currency_mismatch');
  assert.equal(same.ok?.amountCents, 10);
  assert.deepEqual(accounts.ok.map((a) => a.balanceCents), [100, 90, 10]);
});

// ---- AC5 versioning, repeat opens, new files ----------------------------------------------------------------------

test('AC5 [functional] opening an upgraded file again, from later processes, changes nothing and does not fail', async () => {
  const path = buildV1();
  await must(path, []);
  assert.equal(userVersion(path), 2, 'the file was not upgraded');
  const upgraded = snapshot(path);
  for (let i = 0; i < 3; i++) {
    const [accounts] = await must(path, [op('listAccounts')]);
    assert.equal(accounts.length, 4);
    assert.equal(userVersion(path), 2);
    assert.deepEqual(snapshot(path), upgraded);
  }
});

test('AC5 [functional] a file that does not exist yet, or is empty, is created in the new layout at version 2', async () => {
  const missing = newPath();
  const empty = newPath();
  writeFileSync(empty, '');
  for (const path of [missing, empty]) {
    const [a, , t] = await must(path, [op('createAccount', { name: 'e', currency: 'EUR', openingCents: 5 }), op('createAccount', { name: 'f', currency: 'EUR' }), op('transfer', move(1, 2, 5, 'first'))]);
    assert.equal(a.currency, 'EUR');
    assert.equal(t.memo, 'first');
    assert.equal(userVersion(path), 2);
    assert.deepEqual((await must(path, [op('listAccounts')]))[0].map((x) => x.balanceCents), [0, 5]);
  }
});

test('AC5 [regression] a file written by a newer version is refused with unsupported_schema and left untouched', async () => {
  const path = buildV1({ version: 3 });
  const bytes = readFileSync(path);
  const r = await run(path, [op('listAccounts')]);
  assert.equal(r.openError?.code, 'unsupported_schema');
  assert.ok(readFileSync(path).equals(bytes), 'the file changed');
  assert.equal(userVersion(path), 3);
});

// ---- AC10 everything that exists keeps working --------------------------------------------------------------------

test('AC10 [regression] names with quotes and other odd characters are stored exactly and a repeated name is refused', async () => {
  const path = buildV1();
  const names = [`Robert'); --`, `"double" and 'single'`, 'back\\slash %_ wild', 'line\nbreak', 'Zoë 日本'];
  const results = await attempt(path, [...names.map((name) => op('createAccount', { name })), op('createAccount', { name: names[0] }), op('createAccount', { name: 'Ada Lovelace' }), op('listAccounts')]);
  assert.deepEqual(results.slice(0, 5).map((r) => r.ok?.name), names);
  assert.equal(results[5].error?.code, 'duplicate_name');
  assert.equal(results[6].error?.code, 'duplicate_name');
  assert.deepEqual(results[7].ok.map((a) => a.name).slice(-5), names);
});

test('AC10 [regression] single transfers refuse what they refused before, with the same codes, on an upgraded file', async () => {
  const path = buildV1();
  const checks = [
    [op('transfer', move(1, 1, 5)), 'same_account'], [op('transfer', move(1, 99, 5)), 'not_found'], [op('transfer', move(99, 1, 5)), 'not_found'],
    [op('transfer', move(3, 1, 5)), 'insufficient_funds'], [op('transfer', move(1, 3, 1.5)), 'invalid_amount'], [op('transfer', move(1, 3, -5)), 'invalid_amount'],
    [op('transfer', move(1, 3, '5')), 'invalid_amount'], [op('createAccount', { name: '' }), 'invalid_name'], [op('createAccount', { name: 'n'.repeat(81) }), 'invalid_name'],
    [op('createAccount', { name: 'neg', openingCents: -1 }), 'invalid_amount'],
  ];
  const results = await attempt(path, checks.map(([o]) => o));
  assert.deepEqual(results.map((r) => r.error?.code), checks.map(([, code]) => code));
});

test('AC10 [regression] a single transfer is recorded with a UTC timestamp of whole seconds, in the record and in the file', async () => {
  const path = buildV1();
  const [record] = await must(path, [op('transfer', move(1, 3, 5))]);
  assert.match(record.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  const stored = snapshot(path).transfers.at(-1);
  assert.equal(stored.created_at, record.createdAt);
  assert.deepEqual([stored.from_id, stored.to_id, stored.amount_cents], [1, 3, 5]);
  assert.equal(Math.abs(Date.parse(record.createdAt) - Date.now()) < 120000, true);
});

// ---- AC11 documentation and tests --------------------------------------------------------------------------------

test('AC11 [functional] the README documents the new behaviour', async () => {
  const readme = readFileSync(WS + '/README.md', 'utf8');
  for (const word of ['transferBatch', 'memo', 'currency']) assert.ok(readme.includes(word), `README does not mention ${word}`);
});

function testFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? testFiles(root + '/' + e.name) : /\.test\.(mjs|js|cjs)$/.test(e.name) ? [root + '/' + e.name] : []));
}
test('AC11 [functional] the new behaviour has tests in test/ (any test file there that tests transferBatch)', async () => {
  assert.ok(testFiles(WS + '/test').some((f) => { const src = readFileSync(f, 'utf8'); return src.includes('transferBatch') && /\b(test|it)\(/.test(src); }));
});

runQueued();
