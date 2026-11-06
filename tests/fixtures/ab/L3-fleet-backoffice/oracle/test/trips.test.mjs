// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logTrips } from '../src/trips/service.mjs';
test('trips prices in cents', () => { assert.equal(logTrips(createStore(1), 't', { km: 1, rate: 100 }).ok, true); });
