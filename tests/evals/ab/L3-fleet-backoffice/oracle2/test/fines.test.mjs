// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordFines } from '../src/fines/service.mjs';
test('fines prices in cents', () => { assert.equal(recordFines(createStore(1), 't', { points: 1, rate: 100 }).ok, true); });
