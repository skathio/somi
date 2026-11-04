import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoice } from '../src/invoice.mjs';

test('a simple invoice', () => {
  assert.deepEqual(buildInvoice([{ qty: 1, unit: 10, rate: 0.2 }]), { net: 10, tax: 2, gross: 12 });
});
