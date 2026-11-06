// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addFuel } from '../src/fuel/service.mjs';
test('fuel prices in cents', () => { assert.equal(addFuel(createStore(1), 't', { litres: 1, rate: 100 }).ok, true); });
