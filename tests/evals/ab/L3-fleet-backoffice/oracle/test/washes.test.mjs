// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logWashes } from '../src/washes/service.mjs';
test('washes prices in cents', () => { assert.equal(logWashes(createStore(1), 't', { washes: 1, rate: 100 }).ok, true); });
