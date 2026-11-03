// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logRepairs } from '../src/repairs/service.mjs';
test('repairs prices in cents', () => { assert.equal(logRepairs(createStore(1), 't', { hours: 1, rate: 100 }).ok, true); });
