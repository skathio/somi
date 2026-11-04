// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addBatteries } from '../src/batteries/service.mjs';
test('batteries prices in cents', () => { assert.equal(addBatteries(createStore(1), 't', { packs: 1, rate: 100 }).ok, true); });
