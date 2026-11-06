// SOMI-CANARY-H2-9c3f5a1e7b2d4806
import assert from 'node:assert/strict';
import { attempt, CAP, move, must, op, runQueued, seeded, snapshot, stateOf, test } from './harness.mjs';

// ---- AC6, AC7 batches ---------------------------------------------------------------------------------------------

const THREE = [move(1, 2, 100, `it's "ok"`), move(1, 3, 250), move(2, 3, 30, 'third')];

test('AC6 [functional] transferBatch returns the transfer records in the order given, with their fields', async () => {
  const path = await seeded([['a', 1000], ['b', 0], ['c', 0]]);
  const [records] = await must(path, [op('transferBatch', THREE)]);
  assert.equal(records.length, 3);
  assert.deepEqual(records.map((t) => [t.fromId, t.toId, t.amountCents, t.memo]), [[1, 2, 100, `it's "ok"`], [1, 3, 250, null], [2, 3, 30, 'third']]);
  assert.deepEqual(records.map((t) => t.id), [records[0].id, records[0].id + 1, records[0].id + 2]);
});

test('AC6 [functional] transferBatch applies every transfer: the balances move and the ledger lists the records', async () => {
  const path = await seeded([['a', 1000], ['b', 0], ['c', 0]]);
  const [records, accounts, listed] = await must(path, [op('transferBatch', THREE), op('listAccounts'), op('listTransfers')]);
  assert.deepEqual(accounts.map((a) => a.balanceCents), [650, 70, 280]);
  assert.deepEqual(listed, records);
});

test('AC6 [functional] transfers made by a batch carry a UTC timestamp of whole seconds', async () => {
  const path = await seeded([['a', 1000], ['b', 0], ['c', 0]]);
  const [records] = await must(path, [op('transferBatch', THREE)]);
  assert.equal(records.length, 3);
  assert.ok(records.every((t) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(t.createdAt)));
});

test('AC6 [functional] a transfer in a batch may spend what an earlier transfer of the same batch delivered', async () => {
  const path = await seeded([['a', 100], ['b', 0], ['c', 0]]);
  const [records, accounts] = await must(path, [op('transferBatch', [move(1, 2, 100), move(2, 3, 100)]), op('listAccounts')]);
  assert.equal(records.length, 2);
  assert.deepEqual(accounts.map((a) => a.balanceCents), [0, 0, 100]);
});

test('AC6 [functional] the order is respected: spending before the money arrives fails the whole batch', async () => {
  const path = await seeded([['a', 100], ['b', 0], ['c', 0]]);
  const [bad, accounts, transfers] = await attempt(path, [op('transferBatch', [move(2, 3, 100), move(1, 2, 100)]), op('listAccounts'), op('listTransfers')]);
  assert.equal(bad.error?.code, 'insufficient_funds');
  assert.equal(bad.error?.index, 0);
  assert.deepEqual(accounts.ok.map((a) => a.balanceCents), [100, 0, 0]);
  assert.deepEqual(transfers.ok, []);
});

test('AC6 [functional] a batch that fails at its last transfer leaves every earlier transfer undone, the first included', async () => {
  const path = await seeded([['a', 100], ['b', 0]]);
  const before = await stateOf(path);
  const [bad] = await attempt(path, [op('transferBatch', [move(1, 2, 10), move(1, 2, 10), move(1, 2, 5000)])]);
  assert.equal(bad.error?.code, 'insufficient_funds');
  assert.deepEqual(await stateOf(path), before);
  assert.deepEqual(snapshot(path).accounts.map((a) => a.balance_cents), [100, 0]);
});

test('AC6 [functional] after a failed batch the same ledger carries on: the next transfer and batch work and ids have no gap', async () => {
  const path = await seeded([['a', 100], ['b', 0]]);
  const results = await attempt(path, [
    op('transfer', move(1, 2, 1)),
    op('transferBatch', [move(1, 2, 10), move(1, 2, 5000)]),
    op('transfer', move(1, 2, 2)),
    op('transferBatch', [move(1, 2, 3), move(2, 1, 1)]),
    op('listTransfers'),
  ]);
  assert.equal(results[1].error?.code, 'insufficient_funds');
  assert.equal(results[2].error, undefined, 'a transfer after a failed batch must work');
  assert.equal(results[3].error, undefined, 'a batch after a failed batch must work');
  assert.deepEqual(results[4].ok.map((t) => t.id), [1, 2, 3, 4]);
});

const SETUP = [['A', 1000], ['B', 0], ['C', 0, 'EUR'], ['D', CAP - 5]];
const FAILURES = [
  ['invalid_amount', move(1, 2, 0)],
  ['same_account', move(1, 1, 5)],
  ['not_found', move(1, 9999, 5)],
  ['currency_mismatch', move(1, 3, 5)],
  ['invalid_memo', move(1, 2, 5, 'x'.repeat(201))],
  ['insufficient_funds', move(2, 1, 11)],
  ['balance_overflow', move(1, 4, 6)],
];
for (const [code, item] of FAILURES) {
  test(`AC7 [functional] a batch item that would fail alone with ${code} fails the batch with ${code}, reports its position and keeps nothing`, async () => {
    const path = await seeded(SETUP);
    const before = await stateOf(path);
    const [bad] = await attempt(path, [op('transferBatch', [move(1, 2, 10), item, move(1, 2, 1)])]);
    assert.equal(bad.error?.code, code);
    assert.equal(bad.error?.index, 1);
    assert.deepEqual(await stateOf(path), before);
  });
}

test('AC7 [functional] when a later transfer is invalid on its face, the earlier transfer that lacks funds is still the one reported', async () => {
  const path = await seeded(SETUP);
  const [bad] = await attempt(path, [op('transferBatch', [move(1, 2, 5000), move(1, 1, 5)])]);
  assert.equal(bad.error?.code, 'insufficient_funds');
  assert.equal(bad.error?.index, 0);
});

test('AC7 [functional] when several transfers of a batch would fail, the first in the list is reported', async () => {
  const path = await seeded(SETUP);
  const before = await stateOf(path);
  const [bad] = await attempt(path, [op('transferBatch', [move(1, 2, 1), move(1, 2, 5000), move(1, 9999, 5), move(1, 1, 5)])]);
  assert.equal(bad.error?.code, 'insufficient_funds');
  assert.equal(bad.error?.index, 1);
  assert.deepEqual(await stateOf(path), before);
});

// A transfer with two faults is refused for the one the existing checks meet first; a batch reports the same one.
const TWO_FAULTS = [
  ['an invalid amount comes before an unknown account', move(1, 9999, 0), 'invalid_amount'],
  ['the same account comes before an unknown account', move(9999, 9999, 5), 'same_account'],
  ['an unknown account comes before missing funds', move(2, 9999, 10), 'not_found'],
  ['missing funds come before an overflow', move(2, 4, 10), 'insufficient_funds'],
];
for (const [what, item, code] of TWO_FAULTS) {
  test(`AC7 [regression] a single transfer with two faults: ${what}`, async () => {
    const path = await seeded(SETUP);
    const [bad] = await attempt(path, [op('transfer', item)]);
    assert.equal(bad.error?.code, code);
  });
  test(`AC7 [functional] a batch item with two faults is reported like a single transfer: ${what}`, async () => {
    const path = await seeded(SETUP);
    const [bad] = await attempt(path, [op('transferBatch', [move(1, 2, 1), item])]);
    assert.equal(bad.error?.code, code);
    assert.equal(bad.error?.index, 1);
  });
}

// ---- AC8 batch size ---------------------------------------------------------------------------------------------

test('AC8 [boundary] a batch of 500 transfers is applied and one of 501 is refused with invalid_batch and applies nothing', async () => {
  const path = await seeded([['a', 1000], ['b', 0]]);
  const items = (n) => Array.from({ length: n }, () => move(1, 2, 1));
  const [many, tooMany, accounts, transfers] = await attempt(path, [op('transferBatch', items(500)), op('transferBatch', items(501)), op('listAccounts'), op('listTransfers')]);
  assert.equal(many.ok?.length, 500);
  assert.equal(tooMany.error?.code, 'invalid_batch');
  assert.deepEqual(accounts.ok.map((a) => a.balanceCents), [500, 500]);
  assert.equal(transfers.ok.length, 500);
});

test('AC8 [functional] an empty batch is valid: it returns an empty list and changes nothing', async () => {
  const path = await seeded([['a', 10], ['b', 0]]);
  const [none, transfers] = await must(path, [op('transferBatch', []), op('listTransfers')]);
  assert.deepEqual(none, []);
  assert.deepEqual(transfers, []);
});

test('AC8 [safety] something that is not a list is refused with invalid_batch', async () => {
  const path = await seeded([['a', 10], ['b', 0]]);
  const bad = [null, {}, 'x', 7, move(1, 2, 1)];
  const results = await attempt(path, [...bad.map((value) => op('transferBatch', value)), op('listTransfers')]);
  assert.deepEqual(results.slice(0, -1).map((r) => r.error?.code), bad.map(() => 'invalid_batch'));
  assert.deepEqual(results.at(-1).ok, []);
});

// ---- AC9 the edges of money -------------------------------------------------------------------------------------

test('AC9 [regression] a balance can reach 9007199254740991 exactly, and one more cent is refused with balance_overflow', async () => {
  const path = await seeded([['a', 100], ['d', CAP - 10]]);
  const [fills, over, account] = await attempt(path, [op('transfer', move(1, 2, 10)), op('transfer', move(1, 2, 1)), op('getAccount', 2)]);
  assert.equal(fills.ok?.amountCents, 10);
  assert.equal(over.error?.code, 'balance_overflow');
  assert.equal(account.ok.balanceCents, CAP);
});

test('AC9 [regression] the largest representable amount moves exactly, and the next integer is not an amount', async () => {
  const path = await seeded([['rich', CAP], ['empty', 0]]);
  const [moved, tooBig, rich, empty, opening] = await attempt(path, [
    op('transfer', move(1, 2, CAP)), op('transfer', move(2, 1, 2 ** 53)), op('getAccount', 1), op('getAccount', 2), op('createAccount', { name: 'huge', openingCents: 2 ** 53 }),
  ]);
  assert.equal(moved.ok?.amountCents, CAP);
  assert.equal(tooBig.error?.code, 'invalid_amount');
  assert.equal(rich.ok.balanceCents, 0);
  assert.equal(empty.ok.balanceCents, CAP);
  assert.equal(opening.error?.code, 'invalid_amount');
});

test('AC9 [functional] in a batch the balances add up as the transfers are applied: a second deposit can overflow', async () => {
  const path = await seeded([['a', 1000], ['d', CAP - 5]]);
  const before = await stateOf(path);
  const [bad] = await attempt(path, [op('transferBatch', [move(1, 2, 3), move(1, 2, 3)])]);
  assert.equal(bad.error?.code, 'balance_overflow');
  assert.equal(bad.error?.index, 1);
  assert.deepEqual(await stateOf(path), before);
});

test('AC9 [functional] in a batch the balances add up as the transfers are applied: two payments can overdraw together', async () => {
  const path = await seeded([['a', 100], ['b', 0]]);
  const before = await stateOf(path);
  const [bad] = await attempt(path, [op('transferBatch', [move(1, 2, 60), move(1, 2, 60)])]);
  assert.equal(bad.error?.code, 'insufficient_funds');
  assert.equal(bad.error?.index, 1);
  assert.deepEqual(await stateOf(path), before);
});

test('AC9 [functional] a batch can fill an account to exactly 9007199254740991 and the balance reads back exact', async () => {
  const path = await seeded([['a', 100], ['d', CAP - 10]]);
  const [records, account, over] = await attempt(path, [op('transferBatch', [move(1, 2, 4), move(1, 2, 6)]), op('getAccount', 2), op('transferBatch', [move(1, 2, 1)])]);
  assert.equal(records.ok?.length, 2);
  assert.equal(account.ok.balanceCents, CAP);
  assert.equal(over.error?.code, 'balance_overflow');
  assert.equal(over.error?.index, 0);
});

runQueued();
