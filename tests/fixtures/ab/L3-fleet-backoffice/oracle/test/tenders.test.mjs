// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addTenders } from '../src/tenders/service.mjs';
test('tenders prices in cents', () => { assert.equal(addTenders(createStore(1), 't', { bids: 1, rate: 100 }).ok, true); });
