// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerTires } from '../src/tires/service.mjs';
test('tires prices in cents', () => { assert.equal(registerTires(createStore(1), 't', { tires: 1, rate: 100 }).ok, true); });
