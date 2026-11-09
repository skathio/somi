// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordCouriers } from '../src/couriers/service.mjs';
test('couriers prices in cents', () => { assert.equal(recordCouriers(createStore(1), 't', { parcels: 1, rate: 100 }).ok, true); });
