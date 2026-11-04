// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerConsumables } from '../src/consumables/service.mjs';
test('consumables prices in cents', () => { assert.equal(registerConsumables(createStore(1), 't', { boxes: 1, rate: 100 }).ok, true); });
