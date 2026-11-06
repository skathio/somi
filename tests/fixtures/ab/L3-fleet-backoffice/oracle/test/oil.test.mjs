// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addOil } from '../src/oil/service.mjs';
test('oil prices in cents', () => { assert.equal(addOil(createStore(1), 't', { litres: 1, rate: 100 }).ok, true); });
