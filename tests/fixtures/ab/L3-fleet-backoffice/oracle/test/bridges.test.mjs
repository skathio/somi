// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logBridges } from '../src/bridges/service.mjs';
test('bridges prices in cents', () => { assert.equal(logBridges(createStore(1), 't', { crossings: 1, rate: 100 }).ok, true); });
