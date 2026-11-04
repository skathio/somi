// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerInspections } from '../src/inspections/service.mjs';
test('inspections prices in cents', () => { assert.equal(registerInspections(createStore(1), 't', { vehicles: 1, rate: 100 }).ok, true); });
