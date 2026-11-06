// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordStorage } from '../src/storage/service.mjs';
test('storage prices in cents', () => { assert.equal(recordStorage(createStore(1), 't', { pallets: 1, rate: 100 }).ok, true); });
