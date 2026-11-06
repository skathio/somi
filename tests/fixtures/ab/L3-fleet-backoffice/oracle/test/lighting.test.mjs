// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerLighting } from '../src/lighting/service.mjs';
test('lighting prices in cents', () => { assert.equal(registerLighting(createStore(1), 't', { lamps: 1, rate: 100 }).ok, true); });
