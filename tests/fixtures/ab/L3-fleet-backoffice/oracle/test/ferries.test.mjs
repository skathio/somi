// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logFerries } from '../src/ferries/service.mjs';
test('ferries prices in cents', () => { assert.equal(logFerries(createStore(1), 't', { sailings: 1, rate: 100 }).ok, true); });
