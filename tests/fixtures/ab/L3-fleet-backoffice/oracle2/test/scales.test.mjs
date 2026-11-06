// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordScales } from '../src/scales/service.mjs';
test('scales prices in cents', () => { assert.equal(recordScales(createStore(1), 't', { weighings: 1, rate: 100 }).ok, true); });
